export type UserRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'dentist'
  | 'assistant'
  | 'receptionist'
  | 'accountant'
  | 'inventory_manager'
  | 'call_agent';

export type PermissionAction = 'view' | 'create' | 'edit' | 'approve' | 'cancel' | 'print' | 'export';

export type ModuleSection =
  | 'dashboard'
  | 'patients'
  | 'appointments'
  | 'queue'
  | 'doctors'
  | 'odontogram'
  | 'clinical_notes'
  | 'treatment_plans'
  | 'lab_cases'
  | 'services'
  | 'billing'
  | 'accounting'
  | 'budgets'
  | 'inventory'
  | 'sterilization'
  | 'ai_receptionist'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'patient_portal'
  | 'data_safety';

export interface UserAccount {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  orgId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface OrganizationConfig {
  orgId: string;
  clinicName: string;
  location: string;
  currency: string;
  timezone: string;
  isDemo: boolean;
  setupCompleted: boolean;
  chairsCount?: number;
  defaultSlotMinutes?: number;
  taxRatePct?: number;
  shccRegistrationNo?: string;
  phone?: string;
  openingHours?: string;
  updatedAt?: string;
}

export interface StaffMember {
  id: string;
  staffCode: string;
  fullName: string;
  role: UserRole;
  specialty?: string;
  pmdcNumber?: string;
  credentialStatus?: 'unverified' | 'pending' | 'verified';
  consultationFee?: number;
  assignedChair?: string;
  phone?: string;
  workingDays?: string;
  workingHours?: string;
  compensationModel?: string;
  baseSalary?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface Patient {
  id: string;
  patientCode: string;
  fullName: string;
  guardianName?: string;
  dob?: string;
  gender: 'Male' | 'Female' | 'Other';
  mobile: string;
  whatsapp?: string;
  email?: string;
  cnic?: string;
  address?: string;
  city?: string;
  emergencyContact?: string;
  referralSource?: string;
  assignedDoctorId?: string;
  allergies?: string;
  medicalConditions?: string;
  currentMedications?: string;
  medicalAlerts?: string;
  bloodPressure?: string;
  pulseBpm?: number;
  consentSigned?: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt?: string;
}

export interface ServiceCatalogItem {
  id: string;
  code: string;
  name: string;
  category: string;
  standardPrice: number;
  durationMin: number;
  labCost?: number;
  materialCost?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export type AppointmentStatus =
  | 'Requested'
  | 'Pending Confirmation'
  | 'Confirmed'
  | 'Checked In'
  | 'Waiting'
  | 'Seated'
  | 'In Treatment'
  | 'Completed'
  | 'Cancelled'
  | 'Rescheduled'
  | 'No Show';

export interface Appointment {
  id: string;
  appointmentCode: string;
  patientId: string;
  patientName?: string;
  doctorId: string;
  doctorName?: string;
  serviceId?: string;
  serviceName?: string;
  chairNumber?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  source?: string;
  status: AppointmentStatus;
  priority?: 'normal' | 'emergency';
  queueToken?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export type ToothCondition =
  | 'Healthy'
  | 'Caries'
  | 'Missing'
  | 'Restored'
  | 'Crown'
  | 'Root Canal Treated'
  | 'Extraction Planned'
  | 'Extraction Completed';

export type ToothSurface = 'M' | 'D' | 'O' | 'B' | 'L';

export interface ToothState {
  condition: ToothCondition;
  surfaces: ToothSurface[];
  notes?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface OdontogramRecord {
  id: string;
  patientId: string;
  notation: 'FDI' | 'Universal';
  teethJson: string;
  updatedBy: string;
  updatedAt: string;
}

export interface PrescriptionLine {
  medicine: string;
  strength: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface ClinicalNote {
  id: string;
  patientId: string;
  doctorId: string;
  doctorName?: string;
  noteType: 'examination' | 'progress' | 'prescription' | 'perio';
  chiefComplaint?: string;
  findings?: string;
  diagnosis?: string;
  prescriptionJson?: string;
  isFinalized: boolean;
  authorUid: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TreatmentPlanItem {
  tooth?: string;
  serviceName: string;
  phase: string;
  estimatedCost: number;
  status: 'Proposed' | 'Accepted' | 'Declined' | 'In Progress' | 'Completed';
}

export interface TreatmentPlan {
  id: string;
  planCode: string;
  patientId: string;
  patientName?: string;
  doctorId: string;
  doctorName?: string;
  title: string;
  status: string;
  itemsJson?: string;
  totalEstimated: number;
  discount?: number;
  netEstimated?: number;
  consentSigned?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface InvoiceLineItem {
  description: string;
  tooth?: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface PaymentAllocation {
  id: string;
  date: string;
  method: 'Cash' | 'Bank Transfer' | 'Card' | 'Digital Wallet';
  amount: number;
  reference?: string;
  receivedBy: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  patientId: string;
  patientName?: string;
  doctorId?: string;
  itemsJson?: string;
  subtotal?: number;
  discount?: number;
  tax?: number;
  grandTotal: number;
  paidAmount: number;
  balanceDue: number;
  status: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Refunded' | 'Void';
  paymentsJson?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  voucherType: 'Payment' | 'Receive' | 'Journal' | 'Contra' | 'Expense' | 'Adjustment';
  category?: string;
  description?: string;
  linesJson?: string;
  totalDebit: number;
  totalCredit: number;
  referenceId?: string;
  createdBy: string;
  createdAt: string;
}

export interface BudgetItem {
  id: string;
  month: string;
  category: string;
  plannedAmount: number;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  purchaseCost?: number;
  currentStock: number;
  minStock: number;
  batchNumber?: string;
  expiryDate?: string;
  supplierName?: string;
  updatedAt: string;
}

export interface SterilizationLog {
  id: string;
  batchId: string;
  instrumentSet: string;
  equipmentName: string;
  cycleDate: string;
  cycleTime?: string;
  indicatorResult: 'Pass' | 'Fail' | 'Pending';
  responsibleStaff: string;
  notes?: string;
  createdAt: string;
}

export interface CallRecord {
  id: string;
  callCode: string;
  direction: 'inbound' | 'outbound';
  callerNumber: string;
  language?: string;
  intent?: string;
  outcome: string;
  durationSec?: number;
  transferredToHuman?: boolean;
  emergencyFlag: boolean;
  consentDisclosed: boolean;
  appointmentId?: string;
  summary?: string;
  createdAt: string;
}

export interface LabCase {
  id: string;
  caseCode: string;
  patientId: string;
  patientName?: string;
  doctorId: string;
  toothNumber?: string;
  restorationType: string;
  labName: string;
  shade?: string;
  labCost?: number;
  status: 'Created' | 'Sent to Lab' | 'In Progress' | 'Received' | 'Fitted' | 'Rework Required';
  expectedDelivery?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: string;
  timestamp: string;
}

export type BackupStatus =
  | 'Pending'
  | 'Running'
  | 'Completed'
  | 'Failed'
  | 'Verification Required'
  | 'Verified'
  | 'Restored'
  | 'Created';

export type BackupType = 'Daily' | 'Weekly' | 'Monthly' | 'Manual' | 'Pre-Update' | 'Pre-Migration' | 'Pre-Restore';

export interface BackupRecord {
  id: string;
  backupId?: string;
  label: string;
  backupType?: BackupType;
  recordCount: number;
  fileCount?: number;
  sizeBytes?: number;
  destination?: string;
  encryptionStatus?: string;
  checksum?: string;
  checksumStatus?: 'Verified' | 'Pending' | 'Mismatch';
  status: BackupStatus;
  failureReason?: string;
  restoreStatus?: string;
  storagePath?: string;
  wpStored?: boolean;
  gcsStored?: boolean;
  createdBy: string;
  createdAt: string;
}

export type SyncJobStatus = 'Queued' | 'Processing' | 'Completed' | 'Failed' | 'Retrying' | 'Cancelled';

export interface SyncJob {
  id: string;
  jobId: string;
  eventId: string;
  idempotencyKey: string;
  sourceModule: string;
  destination: 'Google Cloud Storage' | 'WordPress Vault' | 'WordPress Public' | 'Microsoft Graph Excel';
  status: SyncJobStatus;
  retryCount: number;
  lastError?: string;
  nextRetryTime?: string;
  createdAt: string;
  completedAt?: string;
}

export interface IntegrationSettings {
  id: string;
  wpSiteUrl?: string;
  wpUsername?: string;
  wpPublicSyncEnabled?: boolean;
  wpBackupSyncEnabled?: boolean;
  msDriveLocation?: 'OneDrive' | 'SharePoint';
  msWorkbookName?: string;
  msWorksheetName?: string;
  msSyncFrequency?: 'Manual' | 'Hourly' | 'Daily';
  msSyncDirection?: 'Export Only' | 'Bidirectional (Owner Approved)';
  gcsBucketName?: string;
  gcsKmsEnabled?: boolean;
  dailyBackupTime?: string;
  weeklyRetentionDays?: number;
  monthlyRetentionDays?: number;
  updatedBy?: string;
  updatedAt: string;
}

export interface RestoreRun {
  id: string;
  backupId: string;
  preRestoreBackupId?: string;
  status: 'Staging Verified' | 'Approved & Applied' | 'Failed';
  verifiedCountsJson: string;
  financialReconciled: boolean;
  checksumMatched: boolean;
  approvedBy?: string;
  notes?: string;
  createdAt: string;
}

export interface ExcelImportRecord {
  id: string;
  filename: string;
  worksheetName: string;
  targetEntity: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  status: 'Previewed' | 'Approved & Imported' | 'Rejected';
  approvedBy?: string;
  createdAt: string;
}

export interface DocumentRef {
  id: string;
  patientId?: string;
  category: 'xray' | 'cbct' | 'consent' | 'lab' | 'clinical_photo';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storagePath: string;
  uploadedBy: string;
  createdAt: string;
}

