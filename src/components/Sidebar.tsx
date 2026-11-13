import React from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Database,
  FileSpreadsheet,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Package,
  PhoneCall,
  Settings,
  ShieldAlert,
  Stethoscope,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { canAccessModule } from '../lib/rbac';
import { ModuleSection } from '../types/erp';

interface NavGroup {
  label: string;
  items: { id: ModuleSection; label: string; icon: React.ComponentType<{ className?: string }> }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Front Desk',
    items: [
      { id: 'patients', label: 'Patient Directory', icon: Users },
      { id: 'appointments', label: 'Appointments & Calendar', icon: Calendar },
      { id: 'queue', label: 'Reception & Queue', icon: Activity },
    ],
  },
  {
    label: 'Clinical EHR',
    items: [
      { id: 'doctors', label: 'Doctors & Staff', icon: UserCheck },
      { id: 'odontogram', label: 'Digital Odontogram', icon: Stethoscope },
      { id: 'clinical_notes', label: 'Examinations & Rx', icon: ClipboardList },
      { id: 'treatment_plans', label: 'Treatment Plans', icon: ClipboardCheck },
      { id: 'lab_cases', label: 'Dental Lab Cases', icon: FlaskConical },
      { id: 'services', label: 'Service Catalog', icon: BookOpen },
    ],
  },
  {
    label: 'Finance',
    items: [
      { id: 'billing', label: 'Patient Billing', icon: CreditCard },
      { id: 'accounting', label: 'General Ledger', icon: FileSpreadsheet },
      { id: 'budgets', label: 'Clinic Budgets', icon: Wallet },
    ],
  },
  {
    label: 'Operations & AI',
    items: [
      { id: 'inventory', label: 'Dental Inventory', icon: Package },
      { id: 'sterilization', label: 'Sterilization & QC', icon: ShieldAlert },
      { id: 'ai_receptionist', label: 'AI Voice Receptionist', icon: PhoneCall },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
      { id: 'patient_portal', label: 'Online Booking Portal', icon: Globe },
      { id: 'audit', label: 'Audit Trail', icon: ShieldAlert },
      { id: 'data_safety', label: 'Data Safety & Backups', icon: Database },
      { id: 'settings', label: 'Settings & Backup', icon: Settings },
    ],
  },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { activeModule, setActiveModule, userAccount, orgConfig } = useErp();
  const role = userAccount?.role || 'receptionist';

  return (
    <aside
      className={`no-print bg-slate-900 text-slate-300 flex flex-col shrink-0 border-r border-slate-800 transition-all duration-200 ${
        collapsed ? 'w-18' : 'w-64'
      }`}
    >
      {/* Brand header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800">
        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={`${import.meta.env.BASE_URL}logo.svg`}
              alt="Tawakal Dental Clinic"
              className="w-7 h-7 rounded-lg shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">Tawakal Dental</p>
              <p className="text-[11px] text-slate-400 truncate">{orgConfig?.location?.split(',')[0] || 'Malir, Karachi'}</p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-5">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => canAccessModule(role, item.id));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              {!collapsed && (
                <p className="px-2.5 mb-1.5 text-[11px] font-medium text-slate-500 tracking-wide">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeModule === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveModule(item.id)}
                      title={collapsed ? item.label : undefined}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
