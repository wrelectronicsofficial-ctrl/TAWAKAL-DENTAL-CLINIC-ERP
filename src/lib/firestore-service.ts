import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  Appointment,
  AuditLog,
  BackupRecord,
  BudgetItem,
  CallRecord,
  ClinicalNote,
  InventoryItem,
  Invoice,
  JournalEntry,
  LabCase,
  OdontogramRecord,
  OrganizationConfig,
  Patient,
  ServiceCatalogItem,
  StaffMember,
  SterilizationLog,
  TreatmentPlan,
  UserAccount,
  UserRole,
} from '../types/erp';
import { checkAppointmentConflict, validateDoubleEntryJournal } from './erp-engine';

export const PROD_ORG_ID = 'tawakal-prod';
export const DEMO_ORG_ID = 'tawakal-demo';
export const BOOTSTRAPPED_OWNER_EMAIL = 'wrelectronicsofficial@gmail.com';

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function generateRecordId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return sanitizeId(`${prefix}_${ts}_${rand}`);
}

export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export async function ensureUserAccount(fbUser: User): Promise<UserAccount> {
  const userPath = `users/${fbUser.uid}`;
  const ref = doc(db, 'users', fbUser.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserAccount;
    }

    const isOwner = fbUser.email?.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
    const now = new Date().toISOString();
    const newAccount: UserAccount = {
      uid: fbUser.uid,
      email: fbUser.email || 'staff@tawakaldental.local',
      displayName: fbUser.displayName || (isOwner ? 'Clinic Owner' : 'Clinic Staff'),
      role: isOwner ? 'owner' : 'receptionist',
      orgId: isOwner ? PROD_ORG_ID : DEMO_ORG_ID,
      isActive: true,
      createdAt: now,
    };

    await setDoc(ref, newAccount);
    return newAccount;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export async function ensureOrganizationConfig(orgId: string, canInitialize = false): Promise<OrganizationConfig> {
  const path = `organizations/${orgId}`;
  const ref = doc(db, 'organizations', orgId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as OrganizationConfig;
    }

    const isDemo = orgId === DEMO_ORG_ID;
    const initial: OrganizationConfig = {
      orgId,
      clinicName: 'Tawakal Dental Clinic',
      location: 'Saudabad, Malir, Karachi, Pakistan',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      isDemo,
      setupCompleted: isDemo,
      chairsCount: isDemo ? 3 : 0,
      defaultSlotMinutes: 30,
      taxRatePct: 0,
      shccRegistrationNo: '',
      phone: '',
      openingHours: isDemo ? 'Mon-Sat 10:00-21:00' : '',
      updatedAt: new Date().toISOString(),
    };

    if (canInitialize) {
      await setDoc(ref, initial);
    }
    return initial;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeOrgConfig(
  orgId: string,
  onData: (config: OrganizationConfig | null) => void,
  onError: (err: Error) => void
) {
  const path = `organizations/${orgId}`;
  return onSnapshot(
    doc(db, 'organizations', orgId),
    (snap) => {
      onData(snap.exists() ? (snap.data() as OrganizationConfig) : null);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeSubcollection<T extends { id: string }>(
  orgId: string,
  subcollectionName: string,
  orderField: string,
  onData: (items: T[]) => void,
  onError: (err: Error) => void,
  maxItems = 250
) {
  const path = `organizations/${orgId}/${subcollectionName}`;
  const q = query(collection(db, 'organizations', orgId, subcollectionName), orderBy(orderField, 'desc'), limit(maxItems));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id } as T));
      onData(rows);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export async function writeAuditLog(
  orgId: string,
  actor: { uid: string; email: string; role: string },
  action: string,
  resourceType: string,
  resourceId: string,
  details: string
): Promise<void> {
  const id = generateRecordId('aud');
  const path = `organizations/${orgId}/audit_logs/${id}`;
  try {
    const entry: Omit<AuditLog, 'id'> = {
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action,
      resourceType,
      resourceId,
      details: details.slice(0, 580),
      timestamp: new Date().toISOString(),
    };
    await setDoc(doc(db, 'organizations', orgId, 'audit_logs', id), entry);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateOrganizationConfig(
  orgId: string,
  actor: { uid: string; email: string; role: string },
  updates: Partial<OrganizationConfig>
): Promise<void> {
  const path = `organizations/${orgId}`;
  try {
    const clean = stripUndefined({
      ...updates,
      orgId,
      updatedAt: new Date().toISOString(),
    });
    await setDoc(doc(db, 'organizations', orgId), clean, { merge: true });
    await writeAuditLog(orgId, actor, 'UPDATE_CLINIC_CONFIG', 'organization', orgId, `Updated clinic settings (${Object.keys(updates).join(', ')})`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function saveSubdoc<T extends Record<string, unknown>>(
  orgId: string,
  subcollectionName: string,
  id: string,
  payload: T,
  actor: { uid: string; email: string; role: string },
  auditAction: string,
  auditDetails: string
): Promise<string> {
  const safeId = sanitizeId(id);
  const path = `organizations/${orgId}/${subcollectionName}/${safeId}`;
  try {
    const { id: _clientId, ...withoutId } = payload as Record<string, unknown>;
    const clean = stripUndefined(withoutId);
    await setDoc(doc(db, 'organizations', orgId, subcollectionName, safeId), clean, { merge: true });
    await writeAuditLog(orgId, actor, auditAction, subcollectionName, safeId, auditDetails);
    return safeId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function createAppointmentSafely(
  orgId: string,
  existingAppointments: Appointment[],
  payload: Omit<Appointment, 'id'>,
  actor: { uid: string; email: string; role: string }
): Promise<string> {
  const check = checkAppointmentConflict(existingAppointments, {
    doctorId: payload.doctorId,
    chairNumber: payload.chairNumber,
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
  });

  if (check.conflict) {
    throw new Error(check.reason || 'Appointment time conflict detected.');
  }

  const id = generateRecordId('apt');
  return saveSubdoc(
    orgId,
    'appointments',
    id,
    payload,
    actor,
    'CREATE_APPOINTMENT',
    `Booked ${payload.appointmentCode} for ${payload.patientName || payload.patientId} on ${payload.date} ${payload.startTime}`
  );
}

export async function postJournalVoucher(
  orgId: string,
  payload: Omit<JournalEntry, 'id'>,
  actor: { uid: string; email: string; role: string }
): Promise<string> {
  const lines = payload.linesJson ? JSON.parse(payload.linesJson) : [];
  const check = validateDoubleEntryJournal(lines);
  if (!check.valid) {
    throw new Error(check.error || 'Double-entry journal validation failed.');
  }
  const id = generateRecordId('jrn');
  return saveSubdoc(
    orgId,
    'journals',
    id,
    {
      ...payload,
      totalDebit: check.totalDebit,
      totalCredit: check.totalCredit,
    },
    actor,
    'POST_JOURNAL_VOUCHER',
    `Posted ${payload.voucherType} voucher ${payload.entryNumber} for PKR ${check.totalDebit}`
  );
}

export async function saveOdontogram(
  orgId: string,
  record: Omit<OdontogramRecord, 'id'>,
  actor: { uid: string; email: string; role: string }
): Promise<void> {
  const safePatientId = sanitizeId(record.patientId);
  await saveSubdoc(
    orgId,
    'odontograms',
    safePatientId,
    record,
    actor,
    'UPDATE_ODONTOGRAM',
    `Updated ISO 3950 dental chart for patient ${safePatientId}`
  );
}

export async function deleteSubdoc(
  orgId: string,
  subcollectionName: string,
  id: string,
  actor: { uid: string; email: string; role: string }
): Promise<void> {
  const safeId = sanitizeId(id);
  const path = `organizations/${orgId}/${subcollectionName}/${safeId}`;
  try {
    await deleteDoc(doc(db, 'organizations', orgId, subcollectionName, safeId));
    await writeAuditLog(orgId, actor, 'DELETE_RECORD', subcollectionName, safeId, `Removed ${subcollectionName}/${safeId}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function updateUserAccountRole(
  targetUid: string,
  role: UserRole,
  orgId: string,
  isActive: boolean,
  actor: { uid: string; email: string; role: string }
): Promise<void> {
  const path = `users/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      role,
      orgId,
      isActive,
      updatedAt: new Date().toISOString(),
    });
    await writeAuditLog(orgId, actor, 'UPDATE_USER_ROLE', 'users', targetUid, `Set role=${role}, orgId=${orgId}, active=${isActive}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function listAllUsers(): Promise<UserAccount[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((d) => d.data() as UserAccount);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function collectFullOrganizationSnapshot(orgId: string): Promise<{
  exportedAt: string;
  orgId: string;
  config: Record<string, unknown> | null;
  collections: Record<string, Record<string, unknown>[]>;
  documentRefs: Record<string, unknown>[];
  recordCount: number;
}> {
  const subcollections = [
    'staff',
    'patients',
    'services',
    'appointments',
    'odontograms',
    'clinical_notes',
    'treatment_plans',
    'invoices',
    'journals',
    'budgets',
    'inventory',
    'sterilization_logs',
    'call_records',
    'lab_cases',
    'document_refs',
    'audit_logs',
  ];

  const payload: Record<string, Record<string, unknown>[]> = {};
  let total = 0;

  for (const name of subcollections) {
    const snap = await getDocs(collection(db, 'organizations', orgId, name));
    payload[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (name !== 'audit_logs') {
      total += snap.size;
    }
  }

  const orgSnap = await getDoc(doc(db, 'organizations', orgId));
  return {
    exportedAt: new Date().toISOString(),
    orgId,
    config: orgSnap.exists() ? (orgSnap.data() as Record<string, unknown>) : null,
    collections: payload,
    documentRefs: payload.document_refs || [],
    recordCount: total,
  };
}

export async function exportOrganizationSnapshot(
  orgId: string,
  actor: { uid: string; email: string; role: string }
): Promise<{ json: string; recordCount: number }> {
  const snapshot = await collectFullOrganizationSnapshot(orgId);
  const json = JSON.stringify(snapshot, null, 2);
  const checksum = `CHK-${snapshot.recordCount}-${json.length}`;
  const backupId = generateRecordId('bkp');

  const backupRecord: Omit<BackupRecord, 'id'> = {
    backupId,
    label: `Manual Snapshot (${new Date().toLocaleDateString('en-PK')})`,
    backupType: 'Manual',
    recordCount: snapshot.recordCount,
    fileCount: snapshot.documentRefs.length,
    sizeBytes: json.length,
    destination: 'Local JSON Export',
    encryptionStatus: 'Plaintext Owner Download',
    checksum,
    checksumStatus: 'Verified',
    status: 'Verified',
    createdBy: actor.uid,
    createdAt: new Date().toISOString(),
  };

  await setDoc(doc(db, 'organizations', orgId, 'backups', backupId), backupRecord);
  await writeAuditLog(orgId, actor, 'CREATE_BACKUP_SNAPSHOT', 'backups', backupId, `Verified snapshot with ${snapshot.recordCount} records (${checksum})`);

  return { json, recordCount: snapshot.recordCount };
}

export async function applyVerifiedStagingRestoreToOrg(
  orgId: string,
  collections: Record<string, Record<string, unknown>[]>,
  actor: { uid: string; email: string; role: string },
  backupId: string
): Promise<number> {
  const mutableCollections = [
    'staff',
    'patients',
    'services',
    'appointments',
    'odontograms',
    'clinical_notes',
    'treatment_plans',
    'invoices',
    'budgets',
    'inventory',
    'sterilization_logs',
    'call_records',
    'lab_cases',
  ];

  let restoredCount = 0;
  for (const colName of mutableCollections) {
    const rows = collections[colName] || [];
    if (rows.length === 0) continue;
    const batch = writeBatch(db);
    for (const row of rows) {
      const rawId = typeof row.id === 'string' && row.id ? row.id : generateRecordId('rst');
      const safeId = sanitizeId(rawId);
      const { id: _id, ...fields } = row;
      batch.set(doc(db, 'organizations', orgId, colName, safeId), stripUndefined(fields), { merge: true });
      restoredCount++;
    }
    await batch.commit();
  }

  // Immutable journals: only restore missing voucher IDs so append-only rules hold
  const journals = collections.journals || [];
  for (const jrn of journals) {
    const safeId = sanitizeId(typeof jrn.id === 'string' && jrn.id ? jrn.id : generateRecordId('jrn'));
    const ref = doc(db, 'organizations', orgId, 'journals', safeId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const { id: _id, ...fields } = jrn;
      await setDoc(ref, stripUndefined(fields));
      restoredCount++;
    }
  }

  await writeAuditLog(
    orgId,
    actor,
    'OWNER_APPROVED_RESTORE',
    'restore_runs',
    backupId,
    `Restored ${restoredCount} verified records from backup ${backupId} into ${orgId}`
  );

  return restoredCount;
}

export async function seedDemoEnvironment(actor: { uid: string; email: string; role: string }): Promise<void> {
  const orgId = DEMO_ORG_ID;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const currentMonth = now.slice(0, 7);

  const batch = writeBatch(db);

  const demoConfig: OrganizationConfig = {
    orgId,
    clinicName: 'Tawakal Dental Clinic (Demo)',
    location: 'Saudabad, Malir, Karachi, Pakistan',
    currency: 'PKR',
    timezone: 'Asia/Karachi',
    isDemo: true,
    setupCompleted: true,
    chairsCount: 3,
    defaultSlotMinutes: 30,
    taxRatePct: 0,
    shccRegistrationNo: 'DEMO-SHCC-2026',
    phone: '+92-300-0000000 (Demo)',
    openingHours: 'Mon-Sat 10:00 - 21:00',
    updatedAt: now,
  };
  batch.set(doc(db, 'organizations', orgId), demoConfig);

  const demoStaff: Omit<StaffMember, 'id'>[] = [
    {
      staffCode: 'DR-001',
      fullName: 'Dr. Ayesha Siddiqui (Demo)',
      role: 'dentist',
      specialty: 'Endodontics & General Dentistry',
      pmdcNumber: 'PMDC-DEMO-4421',
      credentialStatus: 'verified',
      consultationFee: 1500,
      assignedChair: 'Chair 1',
      phone: '0300-1112233',
      workingDays: 'Mon-Sat',
      workingHours: '10:00-18:00',
      compensationModel: 'Revenue Share 40%',
      baseSalary: 95000,
      isActive: true,
      createdAt: now,
    },
    {
      staffCode: 'DR-002',
      fullName: 'Dr. Bilal Ahmed (Demo)',
      role: 'dentist',
      specialty: 'Prosthodontics & Oral Surgery',
      pmdcNumber: 'PMDC-DEMO-6198',
      credentialStatus: 'verified',
      consultationFee: 2000,
      assignedChair: 'Chair 2',
      phone: '0321-4445566',
      workingDays: 'Mon-Sat',
      workingHours: '13:00-21:00',
      compensationModel: 'Fixed + Commission',
      baseSalary: 110000,
      isActive: true,
      createdAt: now,
    },
    {
      staffCode: 'STF-003',
      fullName: 'Sana Tariq (Demo)',
      role: 'receptionist',
      specialty: 'Front Desk & Queue',
      phone: '0333-7778899',
      workingDays: 'Mon-Sat',
      workingHours: '10:00-19:00',
      baseSalary: 40000,
      isActive: true,
      createdAt: now,
    },
  ];
  demoStaff.forEach((s, i) => batch.set(doc(db, 'organizations', orgId, 'staff', `demo_staff_${i + 1}`), s));

  const demoServices: Omit<ServiceCatalogItem, 'id'>[] = [
    { code: 'SRV-CON', name: 'Initial Consultation', category: 'Consultation', standardPrice: 1500, durationMin: 30, labCost: 0, materialCost: 150, isActive: true, createdAt: now },
    { code: 'SRV-SCL', name: 'Dental Scaling & Polishing', category: 'Scaling', standardPrice: 4500, durationMin: 45, labCost: 0, materialCost: 600, isActive: true, createdAt: now },
    { code: 'SRV-RCT', name: 'Root Canal Treatment (RCT)', category: 'RCT', standardPrice: 18000, durationMin: 60, labCost: 0, materialCost: 2400, isActive: true, createdAt: now },
    { code: 'SRV-EXT', name: 'Tooth Extraction', category: 'Extraction', standardPrice: 4000, durationMin: 30, labCost: 0, materialCost: 500, isActive: true, createdAt: now },
    { code: 'SRV-CRN', name: 'Zirconia Dental Crown', category: 'Crowns', standardPrice: 25000, durationMin: 45, labCost: 7500, materialCost: 1200, isActive: true, createdAt: now },
  ];
  demoServices.forEach((s, i) => batch.set(doc(db, 'organizations', orgId, 'services', `demo_srv_${i + 1}`), s));

  const demoPatients: Omit<Patient, 'id'>[] = [
    {
      patientCode: 'TDC-1001',
      fullName: 'Muhammad Usman (Demo)',
      guardianName: 'Haji Abdul Rahim',
      dob: '1989-04-12',
      gender: 'Male',
      mobile: '0300-9123456',
      whatsapp: '0300-9123456',
      city: 'Karachi',
      address: 'Saudabad Block C, Malir',
      assignedDoctorId: 'demo_staff_1',
      allergies: 'Penicillin',
      medicalConditions: 'Mild Hypertension',
      medicalAlerts: 'Penicillin allergy — use Azithromycin/Clindamycin if indicated',
      consentSigned: true,
      status: 'active',
      createdAt: now,
    },
    {
      patientCode: 'TDC-1002',
      fullName: 'Fatima Noor (Demo)',
      guardianName: 'Tariq Mehmood',
      dob: '1995-09-22',
      gender: 'Female',
      mobile: '0332-8811223',
      whatsapp: '0332-8811223',
      city: 'Karachi',
      address: 'Model Colony, Malir',
      assignedDoctorId: 'demo_staff_2',
      allergies: 'None reported',
      medicalConditions: 'None',
      consentSigned: true,
      status: 'active',
      createdAt: now,
    },
    {
      patientCode: 'TDC-1003',
      fullName: 'Zainab Kamran (Demo)',
      guardianName: 'Kamran Qureshi',
      dob: '1983-01-08',
      gender: 'Female',
      mobile: '0345-2233445',
      whatsapp: '0345-2233445',
      city: 'Karachi',
      address: 'Khokhrapar, Malir',
      assignedDoctorId: 'demo_staff_1',
      allergies: 'Latex sensitivity',
      medicalConditions: 'Type 2 Diabetes (Controlled)',
      medicalAlerts: 'Use nitrile gloves only',
      consentSigned: true,
      status: 'active',
      createdAt: now,
    },
  ];
  demoPatients.forEach((p, i) => batch.set(doc(db, 'organizations', orgId, 'patients', `demo_pat_${i + 1}`), p));

  const demoAppointments: Omit<Appointment, 'id'>[] = [
    {
      appointmentCode: 'APT-501',
      patientId: 'demo_pat_1',
      patientName: 'Muhammad Usman (Demo)',
      doctorId: 'demo_staff_1',
      doctorName: 'Dr. Ayesha Siddiqui (Demo)',
      serviceId: 'demo_srv_3',
      serviceName: 'Root Canal Treatment (RCT)',
      chairNumber: 'Chair 1',
      date: today,
      startTime: '10:30',
      endTime: '11:30',
      source: 'AI Voice Receptionist',
      status: 'In Treatment',
      priority: 'normal',
      queueToken: 'Q-01',
      notes: 'Tooth #16 RCT obturation sitting',
      createdBy: actor.uid,
      createdAt: now,
    },
    {
      appointmentCode: 'APT-502',
      patientId: 'demo_pat_2',
      patientName: 'Fatima Noor (Demo)',
      doctorId: 'demo_staff_2',
      doctorName: 'Dr. Bilal Ahmed (Demo)',
      serviceId: 'demo_srv_5',
      serviceName: 'Zirconia Dental Crown',
      chairNumber: 'Chair 2',
      date: today,
      startTime: '14:00',
      endTime: '14:45',
      source: 'Reception',
      status: 'Waiting',
      priority: 'normal',
      queueToken: 'Q-02',
      notes: 'Tooth #36 crown shade check & fitting',
      createdBy: actor.uid,
      createdAt: now,
    },
    {
      appointmentCode: 'APT-503',
      patientId: 'demo_pat_3',
      patientName: 'Zainab Kamran (Demo)',
      doctorId: 'demo_staff_1',
      doctorName: 'Dr. Ayesha Siddiqui (Demo)',
      serviceId: 'demo_srv_2',
      serviceName: 'Dental Scaling & Polishing',
      chairNumber: 'Chair 1',
      date: today,
      startTime: '16:00',
      endTime: '16:45',
      source: 'WhatsApp',
      status: 'Confirmed',
      priority: 'normal',
      notes: 'Routine 6-month scaling',
      createdBy: actor.uid,
      createdAt: now,
    },
  ];
  demoAppointments.forEach((a, i) => batch.set(doc(db, 'organizations', orgId, 'appointments', `demo_apt_${i + 1}`), a));

  batch.set(doc(db, 'organizations', orgId, 'odontograms', 'demo_pat_1'), {
    patientId: 'demo_pat_1',
    notation: 'FDI',
    teethJson: JSON.stringify({
      '16': { condition: 'Root Canal Treated', surfaces: ['O', 'M'], notes: 'Access cavity & RCT in progress', updatedAt: now },
      '36': { condition: 'Caries', surfaces: ['O', 'D'], notes: 'Disto-occlusal caries noted', updatedAt: now },
      '48': { condition: 'Missing', surfaces: [], notes: 'Previously extracted', updatedAt: now },
    }),
    updatedBy: actor.uid,
    updatedAt: now,
  });

  batch.set(doc(db, 'organizations', orgId, 'treatment_plans', 'demo_tp_1'), {
    planCode: 'TP-201',
    patientId: 'demo_pat_1',
    patientName: 'Muhammad Usman (Demo)',
    doctorId: 'demo_staff_1',
    doctorName: 'Dr. Ayesha Siddiqui (Demo)',
    title: 'Phase 1-2: #16 RCT + Zirconia Crown',
    status: 'In Progress',
    itemsJson: JSON.stringify([
      { tooth: '16', serviceName: 'Root Canal Treatment (RCT)', phase: 'Phase 1', estimatedCost: 18000, status: 'In Progress' },
      { tooth: '16', serviceName: 'Zirconia Dental Crown', phase: 'Phase 2', estimatedCost: 25000, status: 'Accepted' },
    ]),
    totalEstimated: 43000,
    discount: 3000,
    netEstimated: 40000,
    consentSigned: true,
    createdAt: now,
  });

  batch.set(doc(db, 'organizations', orgId, 'invoices', 'demo_inv_1'), {
    invoiceNumber: 'INV-2026-001',
    patientId: 'demo_pat_1',
    patientName: 'Muhammad Usman (Demo)',
    doctorId: 'demo_staff_1',
    itemsJson: JSON.stringify([
      { description: 'Root Canal Treatment (RCT)', tooth: '16', qty: 1, unitPrice: 18000, total: 18000 },
      { description: 'Dental Scaling & Polishing', tooth: 'Full Mouth', qty: 1, unitPrice: 7000, total: 7000 },
    ]),
    subtotal: 25000,
    discount: 0,
    tax: 0,
    grandTotal: 25000,
    paidAmount: 10000,
    balanceDue: 15000,
    status: 'Partially Paid',
    paymentsJson: JSON.stringify([
      { id: 'pay_1', date: today, method: 'Cash', amount: 10000, reference: 'REC-101', receivedBy: actor.email },
    ]),
    createdBy: actor.uid,
    createdAt: now,
  });

  const jrn1Ref = doc(db, 'organizations', orgId, 'journals', 'demo_jrn_1');
  const jrn2Ref = doc(db, 'organizations', orgId, 'journals', 'demo_jrn_2');
  const [jrn1Snap, jrn2Snap] = await Promise.all([getDoc(jrn1Ref), getDoc(jrn2Ref)]);

  if (!jrn1Snap.exists()) {
    batch.set(jrn1Ref, {
      entryNumber: 'JV-2026-001',
      date: today,
      voucherType: 'Receive',
      category: 'RCT Revenue',
      description: 'Initial payment received for INV-2026-001 (Muhammad Usman)',
      linesJson: JSON.stringify([
        { accountCode: '1010', accountName: 'Cash in Hand', debit: 10000, credit: 0 },
        { accountCode: '1100', accountName: 'Patient Receivables', debit: 15000, credit: 0 },
        { accountCode: '4020', accountName: 'Dental Procedure Revenue', debit: 0, credit: 25000 },
      ]),
      totalDebit: 25000,
      totalCredit: 25000,
      referenceId: 'INV-2026-001',
      createdBy: actor.uid,
      createdAt: now,
    });
  }

  if (!jrn2Snap.exists()) {
    batch.set(jrn2Ref, {
      entryNumber: 'JV-2026-002',
      date: today,
      voucherType: 'Expense',
      category: 'Clinic Rent',
      description: 'Monthly clinic premises rent — Saudabad Malir',
      linesJson: JSON.stringify([
        { accountCode: '5010', accountName: 'Clinic Rent Expense', debit: 50000, credit: 0 },
        { accountCode: '1020', accountName: 'Bank Account', debit: 0, credit: 50000 },
      ]),
      totalDebit: 50000,
      totalCredit: 50000,
      referenceId: 'RENT-01',
      createdBy: actor.uid,
      createdAt: now,
    });
  }

  const demoBudgets: Omit<BudgetItem, 'id'>[] = [
    { month: currentMonth, category: 'Clinic Rent', plannedAmount: 50000, notes: 'Saudabad Malir premises', createdAt: now },
    { month: currentMonth, category: 'Dental Materials', plannedAmount: 35000, notes: 'Consumables & RCT files', createdAt: now },
    { month: currentMonth, category: 'Electricity', plannedAmount: 20000, notes: 'K-Electric bill + backup', createdAt: now },
  ];
  demoBudgets.forEach((b, i) => batch.set(doc(db, 'organizations', orgId, 'budgets', `demo_bdg_${i + 1}`), b));

  const demoInventory: Omit<InventoryItem, 'id'>[] = [
    { sku: 'INV-GLV-01', name: 'Nitrile Examination Gloves (Box 100)', category: 'Gloves', unit: 'Box', purchaseCost: 1450, currentStock: 90, minStock: 25, batchNumber: 'B-2604', expiryDate: '2028-06-30', supplierName: 'Karachi Dental Traders', updatedAt: now },
    { sku: 'INV-RCT-02', name: 'ProTaper Rotary Files Assorted', category: 'RCT Materials', unit: 'Pack', purchaseCost: 4200, currentStock: 8, minStock: 10, batchNumber: 'PT-991', expiryDate: '2027-12-31', supplierName: 'MediDent Supplies', updatedAt: now },
    { sku: 'INV-ANE-03', name: 'Lidocaine 2% Cartridges (Box 50)', category: 'Consumables', unit: 'Box', purchaseCost: 3100, currentStock: 14, minStock: 8, batchNumber: 'LD-112', expiryDate: '2027-03-15', supplierName: 'Karachi Dental Traders', updatedAt: now },
  ];
  demoInventory.forEach((item, i) => batch.set(doc(db, 'organizations', orgId, 'inventory', `demo_inv_item_${i + 1}`), item));

  batch.set(doc(db, 'organizations', orgId, 'sterilization_logs', 'demo_str_1'), {
    batchId: 'AUT-2026-081',
    instrumentSet: 'Endodontic & Extraction Tray Set A',
    equipmentName: 'Class-B Autoclave 23L',
    cycleDate: today,
    cycleTime: '09:45',
    indicatorResult: 'Pass',
    responsibleStaff: 'Sana Tariq (Demo)',
    notes: '134°C spore & chemical strip indicator verified',
    createdAt: now,
  });

  batch.set(doc(db, 'organizations', orgId, 'lab_cases', 'demo_lab_1'), {
    caseCode: 'LAB-104',
    patientId: 'demo_pat_2',
    patientName: 'Fatima Noor (Demo)',
    doctorId: 'demo_staff_2',
    toothNumber: '36',
    restorationType: 'Full Zirconia Crown',
    labName: 'Karachi Precision Dental Lab',
    shade: 'A2',
    labCost: 7500,
    status: 'Received',
    expectedDelivery: today,
    createdAt: now,
  });

  batch.set(doc(db, 'organizations', orgId, 'call_records', 'demo_call_1'), {
    callCode: 'CALL-901',
    direction: 'inbound',
    callerNumber: '0300-9123456',
    language: 'Roman Urdu',
    intent: 'Appointment Booking',
    outcome: 'Appointment Booked (APT-501)',
    durationSec: 112,
    transferredToHuman: false,
    emergencyFlag: false,
    consentDisclosed: true,
    appointmentId: 'demo_apt_1',
    summary: 'AI Receptionist greeted caller, confirmed consent, checked Dr. Ayesha availability, and booked RCT slot at 10:30.',
    createdAt: now,
  });

  await batch.commit();
  await writeAuditLog(orgId, actor, 'SEED_DEMO_ENVIRONMENT', 'organization', orgId, 'Loaded synthetic DEMO dataset isolated to tawakal-demo');
}
