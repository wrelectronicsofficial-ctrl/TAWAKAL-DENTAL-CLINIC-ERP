import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import {
  DEMO_ORG_ID,
  ensureOrganizationConfig,
  ensureUserAccount,
  PROD_ORG_ID,
  seedDemoEnvironment,
  subscribeOrgConfig,
  subscribeSubcollection,
} from '../lib/firestore-service';
import {
  Appointment,
  AuditLog,
  BackupRecord,
  BudgetItem,
  CallRecord,
  ClinicalNote,
  DocumentRef,
  ExcelImportRecord,
  IntegrationSettings,
  InventoryItem,
  Invoice,
  JournalEntry,
  LabCase,
  ModuleSection,
  OrganizationConfig,
  Patient,
  RestoreRun,
  ServiceCatalogItem,
  StaffMember,
  SterilizationLog,
  SyncJob,
  TreatmentPlan,
  UserAccount,
} from '../types/erp';

interface ErpContextValue {
  firebaseUser: User | null;
  userAccount: UserAccount | null;
  authLoading: boolean;
  authError: string | null;
  activeOrgId: string;
  isDemoMode: boolean;
  orgConfig: OrganizationConfig | null;
  activeModule: ModuleSection;
  setActiveModule: (mod: ModuleSection) => void;
  selectedPatientId: string | null;
  setSelectedPatientId: (id: string | null) => void;
  staff: StaffMember[];
  patients: Patient[];
  services: ServiceCatalogItem[];
  appointments: Appointment[];
  clinicalNotes: ClinicalNote[];
  treatmentPlans: TreatmentPlan[];
  invoices: Invoice[];
  journals: JournalEntry[];
  budgets: BudgetItem[];
  inventory: InventoryItem[];
  sterilizationLogs: SterilizationLog[];
  callRecords: CallRecord[];
  labCases: LabCase[];
  auditLogs: AuditLog[];
  backups: BackupRecord[];
  syncJobs: SyncJob[];
  integrationConfigs: IntegrationSettings[];
  restoreRuns: RestoreRun[];
  excelImports: ExcelImportRecord[];
  documentRefs: DocumentRef[];
  dataError: string | null;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  switchEnvironment: (targetOrgId: string) => Promise<void>;
  loadDemoData: () => Promise<void>;
  getIdToken: () => Promise<string>;
}

const ErpContext = createContext<ErpContextValue | null>(null);

export function ErpProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string>(PROD_ORG_ID);
  const [orgConfig, setOrgConfig] = useState<OrganizationConfig | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleSection>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNote[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sterilizationLogs, setSterilizationLogs] = useState<SterilizationLog[]>([]);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [labCases, setLabCases] = useState<LabCase[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
  const [integrationConfigs, setIntegrationConfigs] = useState<IntegrationSettings[]>([]);
  const [restoreRuns, setRestoreRuns] = useState<RestoreRun[]>([]);
  const [excelImports, setExcelImports] = useState<ExcelImportRecord[]>([]);
  const [documentRefs, setDocumentRefs] = useState<DocumentRef[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthError(null);
      if (!user) {
        setUserAccount(null);
        setAuthLoading(false);
        return;
      }
      try {
        const account = await ensureUserAccount(user);
        setUserAccount(account);
        const initialOrg = account.orgId === PROD_ORG_ID ? PROD_ORG_ID : DEMO_ORG_ID;
        setActiveOrgId(initialOrg);
        await ensureOrganizationConfig(initialOrg);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to initialize clinic account.');
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!firebaseUser || !userAccount) return;
    setDataError(null);

    const handleErr = (err: Error) => {
      console.error('Subscription error:', err);
      setDataError(err.message);
    };

    const unsubs: (() => void)[] = [];
    unsubs.push(subscribeOrgConfig(activeOrgId, setOrgConfig, handleErr));
    unsubs.push(subscribeSubcollection<StaffMember>(activeOrgId, 'staff', 'createdAt', setStaff, handleErr));
    unsubs.push(subscribeSubcollection<Patient>(activeOrgId, 'patients', 'createdAt', setPatients, handleErr));
    unsubs.push(subscribeSubcollection<ServiceCatalogItem>(activeOrgId, 'services', 'createdAt', setServices, handleErr));
    unsubs.push(subscribeSubcollection<Appointment>(activeOrgId, 'appointments', 'createdAt', setAppointments, handleErr));

    const role = userAccount.role;
    if (['owner', 'admin', 'manager', 'dentist', 'assistant'].includes(role)) {
      unsubs.push(subscribeSubcollection<ClinicalNote>(activeOrgId, 'clinical_notes', 'createdAt', setClinicalNotes, handleErr));
      unsubs.push(subscribeSubcollection<SterilizationLog>(activeOrgId, 'sterilization_logs', 'createdAt', setSterilizationLogs, handleErr));
      unsubs.push(subscribeSubcollection<LabCase>(activeOrgId, 'lab_cases', 'createdAt', setLabCases, handleErr));
    } else {
      setClinicalNotes([]);
      setSterilizationLogs([]);
      setLabCases([]);
    }

    if (['owner', 'admin', 'manager', 'dentist', 'assistant', 'accountant', 'receptionist'].includes(role)) {
      unsubs.push(subscribeSubcollection<TreatmentPlan>(activeOrgId, 'treatment_plans', 'createdAt', setTreatmentPlans, handleErr));
    } else {
      setTreatmentPlans([]);
    }

    if (['owner', 'admin', 'manager', 'accountant', 'receptionist'].includes(role)) {
      unsubs.push(subscribeSubcollection<Invoice>(activeOrgId, 'invoices', 'createdAt', setInvoices, handleErr));
    } else {
      setInvoices([]);
    }

    if (['owner', 'admin', 'manager', 'accountant'].includes(role)) {
      unsubs.push(subscribeSubcollection<JournalEntry>(activeOrgId, 'journals', 'createdAt', setJournals, handleErr));
      unsubs.push(subscribeSubcollection<BudgetItem>(activeOrgId, 'budgets', 'createdAt', setBudgets, handleErr));
    } else {
      setJournals([]);
      setBudgets([]);
    }

    if (['owner', 'admin', 'manager', 'inventory_manager', 'assistant', 'dentist'].includes(role)) {
      unsubs.push(subscribeSubcollection<InventoryItem>(activeOrgId, 'inventory', 'updatedAt', setInventory, handleErr));
    } else {
      setInventory([]);
    }

    if (['owner', 'admin', 'manager', 'receptionist', 'dentist', 'assistant', 'call_agent'].includes(role)) {
      unsubs.push(subscribeSubcollection<CallRecord>(activeOrgId, 'call_records', 'createdAt', setCallRecords, handleErr));
    } else {
      setCallRecords([]);
    }

    if (['owner', 'admin', 'manager'].includes(role)) {
      unsubs.push(subscribeSubcollection<AuditLog>(activeOrgId, 'audit_logs', 'timestamp', setAuditLogs, handleErr));
    } else {
      setAuditLogs([]);
    }

    if (['owner', 'admin', 'manager', 'dentist', 'assistant'].includes(role)) {
      unsubs.push(subscribeSubcollection<DocumentRef>(activeOrgId, 'document_refs', 'createdAt', setDocumentRefs, handleErr));
    } else {
      setDocumentRefs([]);
    }

    if (['owner', 'admin'].includes(role)) {
      unsubs.push(subscribeSubcollection<BackupRecord>(activeOrgId, 'backups', 'createdAt', setBackups, handleErr));
      unsubs.push(subscribeSubcollection<SyncJob>(activeOrgId, 'sync_jobs', 'createdAt', setSyncJobs, handleErr));
      unsubs.push(subscribeSubcollection<IntegrationSettings>(activeOrgId, 'integration_configs', 'updatedAt', setIntegrationConfigs, handleErr));
      unsubs.push(subscribeSubcollection<RestoreRun>(activeOrgId, 'restore_runs', 'createdAt', setRestoreRuns, handleErr));
      unsubs.push(subscribeSubcollection<ExcelImportRecord>(activeOrgId, 'excel_imports', 'createdAt', setExcelImports, handleErr));
    } else {
      setBackups([]);
      setSyncJobs([]);
      setIntegrationConfigs([]);
      setRestoreRuns([]);
      setExcelImports([]);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, userAccount, activeOrgId]);

  const signInGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const signInEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Email sign-in failed.';
      if (msg.includes('operation-not-allowed')) {
        setAuthError(
          'Email/Password provider is not enabled yet in Firebase Console (Authentication → Sign-in method). Please use Google Sign-In or enable Email/Password in Firebase Console.'
        );
      } else {
        setAuthError(msg);
      }
    }
  };

  const resetPassword = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to send password reset email.');
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const switchEnvironment = async (targetOrgId: string) => {
    if (targetOrgId === PROD_ORG_ID && userAccount?.orgId !== PROD_ORG_ID) {
      throw new Error('Production clinic access requires Clinic Owner authorization.');
    }
    await ensureOrganizationConfig(targetOrgId);
    setSelectedPatientId(null);
    setActiveOrgId(targetOrgId);
  };

  const loadDemoData = async () => {
    if (!userAccount) return;
    await seedDemoEnvironment({
      uid: userAccount.uid,
      email: userAccount.email,
      role: userAccount.role,
    });
    setActiveOrgId(DEMO_ORG_ID);
  };

  const getIdToken = async () => {
    if (!auth.currentUser) throw new Error('Not authenticated');
    return auth.currentUser.getIdToken();
  };

  const value = useMemo<ErpContextValue>(
    () => ({
      firebaseUser,
      userAccount,
      authLoading,
      authError,
      activeOrgId,
      isDemoMode: activeOrgId === DEMO_ORG_ID,
      orgConfig,
      activeModule,
      setActiveModule,
      selectedPatientId,
      setSelectedPatientId,
      staff,
      patients,
      services,
      appointments,
      clinicalNotes,
      treatmentPlans,
      invoices,
      journals,
      budgets,
      inventory,
      sterilizationLogs,
      callRecords,
      labCases,
      auditLogs,
      backups,
      syncJobs,
      integrationConfigs,
      restoreRuns,
      excelImports,
      documentRefs,
      dataError,
      signInGoogle,
      signInEmail,
      resetPassword,
      logout,
      switchEnvironment,
      loadDemoData,
      getIdToken,
    }),
    [
      firebaseUser,
      userAccount,
      authLoading,
      authError,
      activeOrgId,
      orgConfig,
      activeModule,
      selectedPatientId,
      staff,
      patients,
      services,
      appointments,
      clinicalNotes,
      treatmentPlans,
      invoices,
      journals,
      budgets,
      inventory,
      sterilizationLogs,
      callRecords,
      labCases,
      auditLogs,
      backups,
      syncJobs,
      integrationConfigs,
      restoreRuns,
      excelImports,
      documentRefs,
      dataError,
    ]
  );

  return <ErpContext.Provider value={value}>{children}</ErpContext.Provider>;
}

export function useErp() {
  const ctx = useContext(ErpContext);
  if (!ctx) throw new Error('useErp must be used inside ErpProvider');
  return ctx;
}
