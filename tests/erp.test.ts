import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  applyInventoryMovement,
  calculateInvoiceTotals,
  checkAppointmentConflict,
  computeAvailableSlots,
  detectEmergencyTriage,
  validateDoubleEntryJournal,
} from '../src/lib/erp-engine.ts';
import { canAccessModule, canPerformClinicalAction, canPerformFinancialAction } from '../src/lib/rbac.ts';
import {
  buildEncryptedBackupArchive,
  sanitizePublicWordPressPayload,
  signWordPressHmac,
  verifyAndStageRestore,
} from '../src/lib/backup-engine.ts';
import {
  assertExcelExportAuthorized,
  buildDomainExcelWorkbook,
  parseAndValidateExcelImport,
} from '../src/lib/excel-engine.ts';
import { Appointment } from '../src/types/erp.ts';

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    failed += 1;
  }
}

// 1. Appointment Double-Booking Conflict Prevention Test (Section 40)
runTest('Reject overlapping appointment for same doctor (10:00-10:30 vs 10:15-10:45)', () => {
  const existing: Appointment[] = [
    {
      id: 'a1',
      appointmentCode: 'APT-501',
      patientId: 'p1',
      doctorId: 'doc_a',
      doctorName: 'Doctor A',
      chairNumber: 'Chair 1',
      date: '2026-11-15',
      startTime: '10:00',
      endTime: '10:30',
      status: 'Confirmed',
      createdAt: '2026-11-12T10:00:00Z',
    },
  ];
  const overlapDoctor = checkAppointmentConflict(existing, {
    doctorId: 'doc_a',
    chairNumber: 'Chair 2',
    date: '2026-11-15',
    startTime: '10:15',
    endTime: '10:45',
  });
  assert.equal(overlapDoctor.conflict, true);

  const overlapChair = checkAppointmentConflict(existing, {
    doctorId: 'doc_b',
    chairNumber: 'Chair 1',
    date: '2026-11-15',
    startTime: '10:00',
    endTime: '10:30',
  });
  assert.equal(overlapChair.conflict, true);

  const nonOverlapping = checkAppointmentConflict(existing, {
    doctorId: 'doc_a',
    chairNumber: 'Chair 1',
    date: '2026-11-15',
    startTime: '10:30',
    endTime: '11:00',
  });
  assert.equal(nonOverlapping.conflict, false);
});

// 2. Available Slot Generation Test
runTest('Compute conflict-free appointment slots excluding booked window', () => {
  const existing: Appointment[] = [
    {
      id: 'a1',
      appointmentCode: 'APT-501',
      patientId: 'p1',
      doctorId: 'doc_a',
      chairNumber: 'Chair 1',
      date: '2026-11-15',
      startTime: '10:00',
      endTime: '10:30',
      status: 'Confirmed',
      createdAt: '2026-11-12T10:00:00Z',
    },
  ];
  const slots = computeAvailableSlots('09:30', '11:00', 30, existing, 'doc_a', 'Chair 1', '2026-11-15');
  assert.deepEqual(slots, ['09:30', '10:30']);
});

// 3. Billing & Partial Payment Test (Section 40)
runTest('Patient invoice PKR 25,000 with PKR 10,000 payment -> PKR 15,000 Partially Paid', () => {
  const result = calculateInvoiceTotals(
    [{ description: 'Dental Crown', qty: 1, unitPrice: 25000, total: 25000 }],
    0,
    0,
    [{ id: 'p1', date: '2026-11-15', method: 'Cash', amount: 10000, receivedBy: 'staff@tawakal.pk' }]
  );
  assert.equal(result.grandTotal, 25000);
  assert.equal(result.paidAmount, 10000);
  assert.equal(result.balanceDue, 15000);
  assert.equal(result.status, 'Partially Paid');
});

// 4. Inventory Movement Test (Section 40)
runTest('Inventory opening 100 + purchase 20 - approved usage 30 -> 90; reject negative stock', () => {
  const afterPurchase = applyInventoryMovement(100, 20);
  assert.equal(afterPurchase, 120);
  const afterUsage = applyInventoryMovement(afterPurchase, -30);
  assert.equal(afterUsage, 90);
  assert.throws(() => applyInventoryMovement(10, -25), /Insufficient stock/);
});

// 5. Double-Entry Accounting Journal Test (Section 40)
runTest('Enforce TOTAL DEBIT === TOTAL CREDIT on accounting vouchers', () => {
  const balanced = validateDoubleEntryJournal([
    { accountCode: '1010', accountName: 'Cash', debit: 10000, credit: 0 },
    { accountCode: '4010', accountName: 'Revenue', debit: 0, credit: 10000 },
  ]);
  assert.equal(balanced.valid, true);
  assert.equal(balanced.totalDebit, 10000);
  assert.equal(balanced.totalCredit, 10000);

  const unbalanced = validateDoubleEntryJournal([
    { accountCode: '1010', accountName: 'Cash', debit: 5000, credit: 0 },
    { accountCode: '4010', accountName: 'Revenue', debit: 0, credit: 4000 },
  ]);
  assert.equal(unbalanced.valid, false);
});

// 6. AI Emergency Triage Guard Test
runTest('Detect dental emergencies in English and Roman Urdu for immediate human handover', () => {
  assert.equal(detectEmergencyTriage('Patient has uncontrollable bleeding after extraction'), true);
  assert.equal(detectEmergencyTriage('Meri daant mein severe swelling aur saans lene mein takleef hai'), true);
  assert.equal(detectEmergencyTriage('Mujhe kal scaling ki appointment chahiye'), false);
});

// 7. RBAC Permission Enforcement Test
runTest('RBAC blocks receptionists from clinical approvals and blocks accountants from clinical charting', () => {
  assert.equal(canPerformClinicalAction('receptionist', 'edit'), false);
  assert.equal(canPerformClinicalAction('receptionist', 'approve'), false);
  assert.equal(canAccessModule('receptionist', 'odontogram'), false);
  assert.equal(canPerformClinicalAction('dentist', 'approve'), true);
  assert.equal(canPerformClinicalAction('accountant', 'edit'), false);
  assert.equal(canPerformFinancialAction('accountant', 'approve'), true);
  assert.equal(canAccessModule('owner', 'audit'), true);
});

// 8. Firestore Security Rules Hardening Verification
runTest('Verify firestore.rules contains default-deny, email_verified, double-entry check, and data safety rules', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesText = fs.readFileSync(rulesPath, 'utf-8');
  assert.ok(rulesText.includes('allow read, write: if false;'), 'Global safety net missing');
  assert.ok(rulesText.includes('email_verified == true'), 'Email verification guard missing');
  assert.ok(rulesText.includes('data.totalCredit == data.totalDebit'), 'Journal balance invariant missing');
  assert.ok(rulesText.includes('match /audit_logs/{logId}'), 'Audit logs rule missing');
  assert.ok(rulesText.includes('allow update, delete: if false;'), 'Immutable audit/journal delete lock missing');
  assert.ok(rulesText.includes('match /sync_jobs/{jobId}'), 'Sync jobs rule missing');
  assert.ok(rulesText.includes('match /restore_runs/{restoreId}'), 'Restore runs rule missing');
  assert.ok(rulesText.includes('match /integration_configs/{configId}'), 'Integration configs rule missing');
  assert.ok(rulesText.includes('match /document_refs/{docId}'), 'Document refs rule missing');
});

// 9. RBAC Data Safety access check
runTest('RBAC restricts Data Safety & Backups module to Owner and Admin', () => {
  assert.equal(canAccessModule('owner', 'data_safety'), true);
  assert.equal(canAccessModule('admin', 'data_safety'), true);
  assert.equal(canAccessModule('receptionist', 'data_safety'), false);
  assert.equal(canAccessModule('dentist', 'data_safety'), false);
});

// 10. AES-256-GCM Encrypted Backup, Tamper Detection & Staging Restore Reconciliation
runTest('Encrypt backup with AES-256-GCM, reject wrong key/tampering, and reconcile invoices/journals in staging restore', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const wrongKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

  const built = buildEncryptedBackupArchive({
    backupId: 'bkp_test_001',
    orgId: 'prod_tawakal_dental',
    backupType: 'manual',
    encryptionKey: key,
    snapshot: {
      orgId: 'prod_tawakal_dental',
      exportedAt: '2026-11-12T10:00:00Z',
      config: { clinicName: 'Tawakal Dental Clinic' },
      collections: {
        patients: [{ id: 'p1', patientCode: 'TDC-1001', fullName: 'Ayesha Khan' }],
        invoices: [{ id: 'inv1', invoiceNumber: 'INV-1001', grandTotal: 25000, paidAmount: 10000, balanceDue: 15000 }],
        journals: [{ id: 'jrn1', entryNumber: 'JRN-1001', totalDebit: 10000, totalCredit: 10000 }],
      },
      documentRefs: [{ id: 'doc1', filename: 'panorex.png', storagePath: 'vault/panorex.png' }],
    },
  });

  assert.ok(built.archiveFilename.endsWith('.tawakal.enc'));
  assert.ok(!built.archiveFilename.includes('Ayesha'));
  assert.equal(built.manifest.totalRecords, 3);
  assert.equal(built.manifest.fileCount, 1);
  assert.ok(!built.envelopeBytes.toString('utf8').includes(key), 'Key must never appear inside archive');

  const verified = verifyAndStageRestore({
    envelopeBytes: built.envelopeBytes,
    expectedChecksum: built.archiveChecksum,
    encryptionKey: key,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.checksumMatched, true);
  assert.equal(verified.decryptionVerified, true);
  assert.equal(verified.invoiceTotals.grandTotalPKR, 25000);
  assert.equal(verified.invoiceTotals.invoicesReconciled, true);
  assert.equal(verified.journalTotals.doubleEntryBalanced, true);

  const wrongKeyCheck = verifyAndStageRestore({
    envelopeBytes: built.envelopeBytes,
    expectedChecksum: built.archiveChecksum,
    encryptionKey: wrongKey,
  });
  assert.equal(wrongKeyCheck.valid, false);
  assert.equal(wrongKeyCheck.decryptionVerified, false);

  const tampered = Buffer.from(built.envelopeBytes);
  tampered[tampered.length - 1] ^= 0xff;
  const tamperedCheck = verifyAndStageRestore({
    envelopeBytes: tampered,
    expectedChecksum: built.archiveChecksum,
    encryptionKey: key,
  });
  assert.equal(tamperedCheck.valid, false);
  assert.equal(tamperedCheck.checksumMatched, false);
});

// 11. WordPress Zero-PII Public Payload, HMAC Signing & Plugin Hardening Check
runTest('WordPress sanitization strips clinical/PII fields, HMAC signs deterministically, and PHP vault plugin enforces security', () => {
  const publicData = sanitizePublicWordPressPayload({
    clinicConfig: {
      clinicName: 'Tawakal Dental Clinic',
      location: 'Saudabad, Malir, Karachi',
      phone: '0300-0000000',
      openingHours: 'Mon-Sat 11:00-21:00',
    },
    staff: [
      {
        staffCode: 'DR-01',
        fullName: 'Dr. Fatima Noor',
        role: 'dentist',
        specialty: 'Endodontics',
        isActive: true,
        phone: '0333-PRIVATE-PHONE',
        baseSalary: 250000,
        cnic: '42101-0000000-0',
      },
    ],
    services: [
      {
        code: 'SRV-RCT',
        name: 'Root Canal Treatment',
        category: 'Endodontics',
        durationMin: 60,
        standardPrice: 18000,
        labCost: 4500,
        materialCost: 2200,
        isActive: true,
      },
    ],
    includeApprovedPrices: true,
  });

  const serialized = JSON.stringify(publicData);
  assert.ok(!serialized.includes('0333-PRIVATE-PHONE'), 'Doctor private phone leaked');
  assert.ok(!serialized.includes('42101-0000000-0'), 'CNIC leaked');
  assert.ok(!serialized.includes('baseSalary'), 'Salary leaked');
  assert.ok(!serialized.includes('labCost'), 'Internal lab cost leaked');
  assert.equal(publicData.doctors.length, 1);
  assert.equal(publicData.services[0].publicPricePKR, 18000);

  const sig1 = signWordPressHmac('1700000000', '{"backupId":"bkp_1"}', 'secret_key');
  const sig2 = signWordPressHmac('1700000000', '{"backupId":"bkp_1"}', 'secret_key');
  const sigWrong = signWordPressHmac('1700000001', '{"backupId":"bkp_1"}', 'secret_key');
  assert.equal(sig1, sig2);
  assert.notEqual(sig1, sigWrong);

  const pluginPath = path.resolve(process.cwd(), 'wordpress-plugin/tawakal-private-backup-vault.php');
  const pluginText = fs.readFileSync(pluginPath, 'utf-8');
  assert.ok(pluginText.includes('is_ssl()'), 'WordPress plugin must enforce HTTPS');
  assert.ok(pluginText.includes('tawakal_manage_encrypted_backups'), 'WordPress plugin must check capability');
  assert.ok(pluginText.includes('hash_hmac'), 'WordPress plugin must verify HMAC signature');
  assert.ok(pluginText.includes('Deny from all'), 'WordPress plugin must protect private dir with .htaccess');
  assert.ok(pluginText.includes('409'), 'WordPress plugin must reject duplicate backup IDs');
});

// 12. Async Formatted Excel Export, Controlled Import Validation & RBAC Rejection
async function runAsyncExcelTests() {
  await runTest('Generate formatted PKR Excel workbook, validate imports for duplicates/missing fields, and enforce RBAC export guards', async () => {
    assert.throws(() => assertExcelExportAuthorized('receptionist', 'patients_clinical'), /Unauthorized Excel export/);
    assert.throws(() => assertExcelExportAuthorized('receptionist', 'financial_ledger'), /Unauthorized Excel export/);
    assert.throws(() => assertExcelExportAuthorized('dentist', 'financial_ledger'), /Unauthorized Excel export/);

    const exported = await buildDomainExcelWorkbook(
      'financial_ledger',
      {
        clinicName: 'Tawakal Dental Clinic',
        environment: 'PRODUCTION',
        patients: [],
        appointments: [],
        staff: [],
        services: [],
        treatmentPlans: [],
        invoices: [
          {
            id: 'inv_1',
            invoiceNumber: 'INV-2001',
            patientId: 'p1',
            patientName: 'Bilal Ahmed',
            grandTotal: 18000,
            paidAmount: 18000,
            balanceDue: 0,
            status: 'Paid',
            createdAt: '2026-11-12T12:00:00Z',
          },
        ],
        journals: [
          {
            id: 'jrn_1',
            entryNumber: 'JRN-2001',
            date: '2026-11-12',
            voucherType: 'Receipt',
            category: 'Patient Receipt',
            description: 'Scaling & Polishing',
            totalDebit: 18000,
            totalCredit: 18000,
            referenceId: 'inv_1',
          },
        ],
        budgets: [],
        inventory: [],
        sterilizationLogs: [],
        callRecords: [],
      },
      { email: 'owner@tawakal.pk', role: 'owner' }
    );

    assert.ok(exported.filename.endsWith('.xlsx'));
    assert.equal(exported.sheetSummary['Invoices'], 1);
    assert.equal(exported.sheetSummary['Accounting Journals'], 1);

    const wbRead = new ExcelJS.Workbook();
    await wbRead.xlsx.load(exported.buffer as unknown as ArrayBuffer);
    assert.ok(wbRead.getWorksheet('Export Summary'));
    assert.ok(wbRead.getWorksheet('Invoices'));
    assert.ok(wbRead.getWorksheet('Accounting Journals'));

    const importWb = new ExcelJS.Workbook();
    const ws = importWb.addWorksheet('Patients');
    ws.addRow(['patientCode', 'fullName', 'gender', 'mobile']);
    ws.addRow(['TDC-9001', 'Sana Tariq', 'Female', '03001234567']);
    ws.addRow(['TDC-9002', 'Incomplete Patient', 'Male', '']);
    ws.addRow(['TDC-1001', 'Duplicate Code Patient', 'Male', '03219876543']);
    const importBuf = Buffer.from(await importWb.xlsx.writeBuffer());

    const preview = await parseAndValidateExcelImport({
      buffer: importBuf,
      targetEntity: 'patients',
      existingCodes: ['TDC-1001'],
    });
    assert.equal(preview.totalRows, 3);
    assert.equal(preview.validRows, 1);
    assert.equal(preview.errorRows, 2);
    assert.equal(preview.rows[0].valid, true);
    assert.ok(preview.rows[1].errors.some((e) => e.includes('Mobile')));
    assert.ok(preview.rows[2].errors.some((e) => e.includes('Duplicate')));
  });

  // 13. GitHub CI/CD, Static Assets & Secret Safety Check
  await runTest('Verify GitHub Actions workflows, lockfile, README, assets, and zero frontend secret exposure', () => {
    const root = process.cwd();
    assert.ok(fs.existsSync(path.join(root, 'package-lock.json')), 'package-lock.json required for npm ci');
    assert.ok(fs.existsSync(path.join(root, '.github/workflows/deploy.yml')), 'GitHub Pages workflow missing');
    assert.ok(fs.existsSync(path.join(root, '.github/workflows/deploy-cloudrun.yml')), 'Cloud Run workflow missing');
    assert.ok(fs.existsSync(path.join(root, 'README.md')), 'README.md missing');
    assert.ok(fs.existsSync(path.join(root, 'public/logo.svg')), 'public/logo.svg missing');
    assert.ok(fs.existsSync(path.join(root, 'public/404.html')), 'public/404.html missing');

    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
    assert.ok(gitignore.includes('.env'), '.gitignore must ignore .env');
    assert.ok(gitignore.includes('.clinic_vault/'), '.gitignore must ignore .clinic_vault/');
    assert.ok(gitignore.includes('*service-account*.json'), '.gitignore must ignore service account JSON');

    const deployYml = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf-8');
    assert.ok(deployYml.includes('npm ci'), 'Workflow must use npm ci');
    assert.ok(deployYml.includes('npm test'), 'Workflow must run tests');
    assert.ok(deployYml.includes('VITE_BASE_PATH'), 'Workflow must set VITE_BASE_PATH');

    const srcWalk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) srcWalk(full);
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          const content = fs.readFileSync(full, 'utf-8');
          assert.ok(!content.includes('VITE_GEMINI'), `Forbidden VITE_GEMINI secret reference in ${full}`);
          assert.ok(!/env\.WP_APP_PASSWORD|env\.MS_CLIENT_SECRET|env\.BACKUP_ENCRYPTION_KEY|env\.GEMINI_API_KEY/.test(content), `Backend secret env read in frontend ${full}`);
        }
      }
    };
    srcWalk(path.join(root, 'src'));
  });

  // 14. Firebase Configuration & Auth Persistence Verification
  await runTest('Verify Firebase config completeness, persistence, and zero VITE_FIREBASE placeholder overrides', () => {
    const root = process.cwd();
    const fbConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase-applet-config.json'), 'utf-8')) as Record<string, string>;
    assert.ok(fbConfig.projectId && fbConfig.projectId !== 'remixed-project-id', 'Valid Firebase projectId required');
    assert.ok(fbConfig.appId && fbConfig.appId.includes(':web:'), 'Valid Firebase Web appId required');
    assert.ok(fbConfig.apiKey && fbConfig.apiKey.startsWith('AIza'), 'Valid Firebase Web apiKey required');
    assert.ok(fbConfig.authDomain && fbConfig.authDomain.endsWith('.firebaseapp.com'), 'Valid Firebase authDomain required');
    assert.ok(fbConfig.firestoreDatabaseId, 'Named Firestore database ID required');

    const fbTs = fs.readFileSync(path.join(root, 'src/lib/firebase.ts'), 'utf-8');
    assert.ok(fbTs.includes('browserLocalPersistence'), 'Auth persistence must be configured');
    assert.ok(fbTs.includes('getDocFromServer'), 'Firestore server connection check required');
  });

  // 15. Daily Appointment Bulk Excel Export, Microsoft Graph Routes & A4 Print Utility Verification
  await runTest('Export daily appointments to Excel with chronological sort & RBAC, and verify A4 print CSS + Graph routes', async () => {
    assert.doesNotThrow(() => assertExcelExportAuthorized('receptionist', 'daily_appointments'));
    assert.doesNotThrow(() => assertExcelExportAuthorized('dentist', 'daily_appointments'));
    assert.throws(() => assertExcelExportAuthorized('accountant', 'daily_appointments'), /Unauthorized Excel export/);
    assert.throws(() => assertExcelExportAuthorized('call_agent', 'daily_appointments'), /Unauthorized Excel export/);

    const sampleAppointments: Appointment[] = [
      {
        id: 'apt_late',
        appointmentCode: 'APT-002',
        patientId: 'p2',
        patientName: 'Ayesha Khan',
        doctorId: 'doc_1',
        doctorName: 'Dr. Usama Tariq',
        chairNumber: 'Chair 2',
        date: '2026-11-13',
        startTime: '14:30',
        endTime: '15:00',
        serviceName: 'Root Canal Therapy',
        priority: 'emergency',
        status: 'Confirmed',
        source: 'Phone',
        queueToken: 'T-02',
        notes: 'Acute pain',
        createdAt: '2026-11-13T08:00:00Z',
      },
      {
        id: 'apt_early',
        appointmentCode: 'APT-001',
        patientId: 'p1',
        patientName: 'Zainab Ali',
        doctorId: 'doc_1',
        doctorName: 'Dr. Usama Tariq',
        chairNumber: 'Chair 1',
        date: '2026-11-13',
        startTime: '09:15',
        endTime: '09:45',
        serviceName: 'Scaling & Polishing',
        priority: 'normal',
        status: 'Completed',
        source: 'Reception',
        queueToken: 'T-01',
        createdAt: '2026-11-13T07:30:00Z',
      },
      {
        id: 'apt_other_day',
        appointmentCode: 'APT-003',
        patientId: 'p3',
        patientName: 'Hamza Raza',
        doctorId: 'doc_1',
        doctorName: 'Dr. Usama Tariq',
        chairNumber: 'Chair 1',
        date: '2026-11-14',
        startTime: '10:00',
        endTime: '10:30',
        serviceName: 'Consultation',
        priority: 'normal',
        status: 'Confirmed',
        source: 'Portal',
        createdAt: '2026-11-13T08:15:00Z',
      },
    ];

    const exportedDaily = await buildDomainExcelWorkbook(
      'daily_appointments',
      {
        clinicName: 'Tawakal Dental Clinic',
        environment: 'PRODUCTION',
        targetDate: '2026-11-13',
        doctorFilterLabel: 'Dr. Usama Tariq',
        patients: [],
        appointments: sampleAppointments as unknown as Record<string, unknown>[],
        staff: [],
        services: [],
        treatmentPlans: [],
        invoices: [],
        journals: [],
        budgets: [],
        inventory: [],
        sterilizationLogs: [],
        callRecords: [],
      },
      { email: 'reception@tawakal.pk', role: 'receptionist' }
    );

    assert.equal(exportedDaily.filename, 'Tawakal_Dental_daily_appointments_PRODUCTION_2026-11-13.xlsx');
    assert.equal(exportedDaily.sheetSummary['Daily Appointments'], 2);

    const wbDaily = new ExcelJS.Workbook();
    await wbDaily.xlsx.load(exportedDaily.buffer as unknown as ArrayBuffer);
    assert.ok(wbDaily.getWorksheet('Export Summary'));
    const wsDaily = wbDaily.getWorksheet('Daily Appointments');
    assert.ok(wsDaily, 'Daily Appointments worksheet must exist');
    assert.equal(wsDaily.getRow(2).getCell(1).value, 'APT-001');
    assert.equal(wsDaily.getRow(2).getCell(3).value, '09:15');
    assert.equal(wsDaily.getRow(3).getCell(1).value, 'APT-002');
    assert.equal(wsDaily.getRow(3).getCell(3).value, '14:30');

    const root = process.cwd();
    const indexCss = fs.readFileSync(path.join(root, 'src/index.css'), 'utf-8');
    assert.ok(indexCss.includes('@page'), 'A4 @page print rule required');
    assert.ok(indexCss.includes('A4'), 'A4 page size required in @page');
    assert.ok(indexCss.includes('.no-print'), '.no-print utility required');
    assert.ok(indexCss.includes('.print-hide'), '.print-hide utility required');
    assert.ok(indexCss.includes('.print-only'), '.print-only utility required');
    assert.ok(indexCss.includes('.print-a4-sheet'), '.print-a4-sheet utility required');

    const sidebarTsx = fs.readFileSync(path.join(root, 'src/components/Sidebar.tsx'), 'utf-8');
    assert.ok(sidebarTsx.includes('no-print'), 'Sidebar must include no-print class');

    const serverTs = fs.readFileSync(path.join(root, 'server.ts'), 'utf-8');
    assert.ok(serverTs.includes('/api/microsoft/status'), 'Microsoft Graph status route required');
    assert.ok(serverTs.includes('/api/microsoft/excel/export-daily-appointments'), 'Microsoft Graph daily appointments export route required');
  });

  console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAsyncExcelTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
