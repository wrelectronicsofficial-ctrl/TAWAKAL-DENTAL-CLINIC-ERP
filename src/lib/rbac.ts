import { ModuleSection, PermissionAction, UserRole } from '../types/erp';

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Clinic Owner',
  admin: 'Clinic Administrator',
  manager: 'Clinic Manager',
  dentist: 'Dentist',
  assistant: 'Dental Assistant',
  receptionist: 'Receptionist',
  accountant: 'Accountant',
  inventory_manager: 'Inventory Manager',
  call_agent: 'Call Centre Agent',
};

const ALL_ACTIONS: PermissionAction[] = ['view', 'create', 'edit', 'approve', 'cancel', 'print', 'export'];

export const ROLE_MODULES: Record<UserRole, ModuleSection[]> = {
  owner: [
    'dashboard', 'patients', 'appointments', 'queue', 'doctors',
    'odontogram', 'clinical_notes', 'treatment_plans', 'lab_cases', 'services',
    'billing', 'accounting', 'budgets', 'inventory', 'sterilization',
    'ai_receptionist', 'reports', 'audit', 'data_safety', 'settings', 'patient_portal',
  ],
  admin: [
    'dashboard', 'patients', 'appointments', 'queue', 'doctors',
    'odontogram', 'clinical_notes', 'treatment_plans', 'lab_cases', 'services',
    'billing', 'accounting', 'budgets', 'inventory', 'sterilization',
    'ai_receptionist', 'reports', 'audit', 'data_safety', 'settings', 'patient_portal',
  ],
  manager: [
    'dashboard', 'patients', 'appointments', 'queue', 'doctors',
    'services', 'billing', 'accounting', 'budgets', 'inventory', 'sterilization',
    'ai_receptionist', 'reports', 'audit',
  ],
  dentist: [
    'dashboard', 'patients', 'appointments', 'queue', 'doctors',
    'odontogram', 'clinical_notes', 'treatment_plans', 'lab_cases', 'services',
    'sterilization', 'reports',
  ],
  assistant: [
    'dashboard', 'patients', 'appointments', 'queue',
    'odontogram', 'clinical_notes', 'lab_cases', 'inventory', 'sterilization',
  ],
  receptionist: [
    'dashboard', 'patients', 'appointments', 'queue', 'doctors',
    'services', 'billing', 'ai_receptionist', 'patient_portal',
  ],
  accountant: [
    'dashboard', 'billing', 'accounting', 'budgets', 'reports',
  ],
  inventory_manager: [
    'dashboard', 'inventory', 'sterilization', 'reports',
  ],
  call_agent: [
    'dashboard', 'patients', 'appointments', 'ai_receptionist', 'patient_portal',
  ],
};

export const ROLE_CLINICAL_ACTIONS: Record<UserRole, PermissionAction[]> = {
  owner: ALL_ACTIONS,
  admin: ALL_ACTIONS,
  manager: ['view', 'print', 'export'],
  dentist: ['view', 'create', 'edit', 'approve', 'print', 'export'],
  assistant: ['view', 'create'],
  receptionist: [],
  accountant: [],
  inventory_manager: [],
  call_agent: [],
};

export const ROLE_FINANCIAL_ACTIONS: Record<UserRole, PermissionAction[]> = {
  owner: ALL_ACTIONS,
  admin: ALL_ACTIONS,
  manager: ['view', 'create', 'edit', 'approve', 'print', 'export'],
  dentist: ['view'],
  assistant: [],
  receptionist: ['view', 'create', 'print'],
  accountant: ['view', 'create', 'edit', 'approve', 'print', 'export'],
  inventory_manager: ['view'],
  call_agent: [],
};

export function canAccessModule(role: UserRole, section: ModuleSection): boolean {
  return ROLE_MODULES[role]?.includes(section) ?? false;
}

export function canPerformClinicalAction(role: UserRole, action: PermissionAction): boolean {
  return ROLE_CLINICAL_ACTIONS[role]?.includes(action) ?? false;
}

export function canPerformFinancialAction(role: UserRole, action: PermissionAction): boolean {
  return ROLE_FINANCIAL_ACTIONS[role]?.includes(action) ?? false;
}
