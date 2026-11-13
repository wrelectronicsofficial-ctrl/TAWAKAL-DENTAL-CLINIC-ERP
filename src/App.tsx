import React, { Component, ErrorInfo, ReactNode, useMemo, useState } from 'react';
import { AlertCircle, LogOut, Plus, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { ErpProvider, useErp } from './context/ErpContext';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { SetupWizardModal } from './components/SetupWizardModal';
import { PatientSearchHoverCard } from './components/PatientSearchHoverCard';
import { DashboardView } from './modules/DashboardView';
import { PatientsView } from './modules/PatientsView';
import { AppointmentsView } from './modules/AppointmentsView';
import { OdontogramView } from './modules/OdontogramView';
import { ClinicalRecordsView } from './modules/ClinicalRecordsView';
import { BillingAndAccountingView } from './modules/BillingAndAccountingView';
import { OperationsView } from './modules/OperationsView';
import { AiReceptionistView } from './modules/AiReceptionistView';
import { ManagementView } from './modules/ManagementView';
import { DataSafetyView } from './modules/DataSafetyView';
import { canAccessModule, ROLE_LABELS } from './lib/rbac';
import { DEMO_ORG_ID, PROD_ORG_ID } from './lib/firestore-service';

function WorkspaceShell() {
  const {
    firebaseUser,
    userAccount,
    authLoading,
    activeModule,
    setActiveModule,
    isDemoMode,
    switchEnvironment,
    patients,
    appointments,
    setSelectedPatientId,
    logout,
    dataError,
  } = useErp();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const [hoveredPatientId, setHoveredPatientId] = useState<string | null>(null);

  const quickSearchResults = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    if (!q) return [];
    return patients
      .filter(
        (p) =>
          p.fullName.toLowerCase().includes(q) ||
          p.patientCode.toLowerCase().includes(q) ||
          p.mobile.toLowerCase().includes(q)
      )
      .slice(0, 5);
  }, [patients, globalQuery]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Verifying clinic credentials...
      </div>
    );
  }

  if (!firebaseUser || !userAccount) {
    return <LoginScreen />;
  }

  if (!userAccount.isActive) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md text-center space-y-4">
          <ShieldAlert className="w-8 h-8 text-red-600 mx-auto" />
          <h2 className="text-lg font-semibold text-slate-900">Account Deactivated</h2>
          <p className="text-xs text-slate-600">Your clinic staff account has been deactivated by the Clinic Owner.</p>
          <button onClick={logout} className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg cursor-pointer">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const role = userAccount.role;
  const safeModule = canAccessModule(role, activeModule) ? activeModule : 'dashboard';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Explicit DEMO MODE Banner */}
        {isDemoMode && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 no-print">
            <span className="font-semibold">
              DEMO MODE ACTIVE — Displaying isolated synthetic dataset (never mixed with Production records)
            </span>
            {userAccount.orgId === PROD_ORG_ID && (
              <button
                type="button"
                onClick={() => switchEnvironment(PROD_ORG_ID)}
                className="px-2.5 py-1 bg-amber-900 text-white rounded font-medium cursor-pointer"
              >
                Return to Production Clinic
              </button>
            )}
          </div>
        )}

        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-6 no-print">
          {/* Global Patient Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="Search patient by name, TDC ID, or phone..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-blue-600"
            />
            {quickSearchResults.length > 0 && (
              <div
                onMouseLeave={() => setHoveredPatientId(null)}
                className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 divide-y divide-slate-100"
              >
                {quickSearchResults.map((p) => {
                  const openPatient = () => {
                    setSelectedPatientId(p.id);
                    setActiveModule('patients');
                    setGlobalQuery('');
                    setHoveredPatientId(null);
                  };
                  return (
                    <div
                      key={p.id}
                      onMouseEnter={() => setHoveredPatientId(p.id)}
                      className="relative"
                    >
                      <button
                        type="button"
                        onClick={openPatient}
                        onFocus={() => setHoveredPatientId(p.id)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between cursor-pointer"
                      >
                        <span className="font-medium text-slate-900">{p.fullName}</span>
                        <span className="font-mono text-slate-500">{p.patientCode}</span>
                      </button>
                      {hoveredPatientId === p.id && (
                        <div className="hidden md:block absolute left-full top-0 pl-2 z-50">
                          <PatientSearchHoverCard
                            patient={p}
                            appointments={appointments}
                            role={role}
                            onSelect={openPatient}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {canAccessModule(role, 'appointments') && (
              <button
                type="button"
                onClick={() => setActiveModule('appointments')}
                className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Quick Appointment</span>
              </button>
            )}

            {!isDemoMode && userAccount.role === 'owner' && (
              <button
                type="button"
                onClick={() => switchEnvironment(DEMO_ORG_ID)}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
              >
                Demo Sandbox
              </button>
            )}

            <div className="pl-3 border-l border-slate-200 flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold text-slate-900 truncate max-w-[160px]">{userAccount.displayName}</p>
                <p className="text-[11px] text-slate-500">{ROLE_LABELS[role]}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                title="Sign out"
                className="p-2 text-slate-500 hover:text-red-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto print-main">
          {dataError && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-700 no-print">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{dataError}</span>
            </div>
          )}

          {safeModule === 'dashboard' && <DashboardView onOpenWizard={() => setShowWizard(true)} />}
          {safeModule === 'patients' && <PatientsView />}
          {safeModule === 'appointments' && <AppointmentsView key="calendar" defaultMode="calendar" />}
          {safeModule === 'queue' && <AppointmentsView key="queue" defaultMode="queue" />}
          {safeModule === 'odontogram' && <OdontogramView />}
          {safeModule === 'clinical_notes' && <ClinicalRecordsView key="notes" defaultTab="notes" />}
          {safeModule === 'treatment_plans' && <ClinicalRecordsView key="plans" defaultTab="plans" />}
          {safeModule === 'lab_cases' && <ClinicalRecordsView key="lab" defaultTab="lab" />}
          {safeModule === 'billing' && <BillingAndAccountingView key="billing" defaultTab="billing" />}
          {safeModule === 'accounting' && <BillingAndAccountingView key="accounting" defaultTab="accounting" />}
          {safeModule === 'budgets' && <BillingAndAccountingView key="budgets" defaultTab="budgets" />}
          {safeModule === 'inventory' && <OperationsView key="inventory" defaultTab="inventory" />}
          {safeModule === 'sterilization' && <OperationsView key="sterilization" defaultTab="sterilization" />}
          {safeModule === 'doctors' && <OperationsView key="doctors" defaultTab="doctors" />}
          {safeModule === 'services' && <OperationsView key="services" defaultTab="services" />}
          {safeModule === 'ai_receptionist' && <AiReceptionistView />}
          {safeModule === 'reports' && <ManagementView key="reports" view="reports" onOpenWizard={() => setShowWizard(true)} />}
          {safeModule === 'audit' && <ManagementView key="audit" view="audit" onOpenWizard={() => setShowWizard(true)} />}
          {safeModule === 'patient_portal' && <ManagementView key="portal" view="patient_portal" onOpenWizard={() => setShowWizard(true)} />}
          {safeModule === 'data_safety' && <DataSafetyView />}
          {safeModule === 'settings' && <ManagementView key="settings" view="settings" onOpenWizard={() => setShowWizard(true)} />}
        </main>
      </div>

      {showWizard && <SetupWizardModal onClose={() => setShowWizard(false)} />}
    </div>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected application error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tawakal ERP Runtime Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4 shadow-sm">
            <AlertCircle className="w-8 h-8 text-red-600 mx-auto" />
            <h1 className="text-lg font-semibold text-slate-900">Tawakal Dental Clinic ERP</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              The interface encountered an unexpected error and recovered safely to protect your clinical session.
            </p>
            <p className="text-[11px] font-mono text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ErpProvider>
        <WorkspaceShell />
      </ErpProvider>
    </AppErrorBoundary>
  );
}
