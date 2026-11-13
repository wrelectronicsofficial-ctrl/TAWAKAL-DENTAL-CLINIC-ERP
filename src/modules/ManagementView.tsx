import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  DatabaseBackup,
  Download,
  Globe,
  Printer,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { PrintLetterhead } from '../components/PrintLetterhead';
import {
  DEMO_ORG_ID,
  exportOrganizationSnapshot,
  generateRecordId,
  listAllUsers,
  PROD_ORG_ID,
  saveSubdoc,
  updateUserAccountRole,
} from '../lib/firestore-service';
import { formatPKR } from '../lib/erp-engine';
import { ROLE_LABELS } from '../lib/rbac';
import { UserAccount, UserRole } from '../types/erp';

export function ManagementView({
  view,
  onOpenWizard,
}: {
  view: 'reports' | 'audit' | 'settings' | 'patient_portal';
  onOpenWizard: () => void;
}) {
  const {
    activeOrgId,
    isDemoMode,
    orgConfig,
    userAccount,
    patients,
    appointments,
    staff,
    services,
    invoices,
    journals,
    inventory,
    callRecords,
    auditLogs,
    backups,
    switchEnvironment,
    loadDemoData,
  } = useErp();

  const [usersList, setUsersList] = useState<UserAccount[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [portalName, setPortalName] = useState('');
  const [portalPhone, setPortalPhone] = useState('');
  const [portalServiceId, setPortalServiceId] = useState('');
  const [portalDoctorId, setPortalDoctorId] = useState('');
  const [portalDate, setPortalDate] = useState(new Date().toISOString().slice(0, 10));
  const [portalTime, setPortalTime] = useState('12:00');
  const [portalSuccess, setPortalSuccess] = useState<string | null>(null);

  const isOwner = userAccount?.role === 'owner' || userAccount?.role === 'admin';

  useEffect(() => {
    if (view === 'settings' && isOwner) {
      listAllUsers().then(setUsersList).catch(() => {});
    }
  }, [view, isOwner]);

  const downloadCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBackupSnapshot = async () => {
    if (!userAccount) return;
    setBackingUp(true);
    setStatusMsg(null);
    try {
      const { json, recordCount } = await exportOrganizationSnapshot(activeOrgId, {
        uid: userAccount.uid,
        email: userAccount.email,
        role: userAccount.role,
      });
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tawakal-backup-${activeOrgId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg(`Verified backup snapshot created and downloaded (${recordCount} records).`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBackingUp(false);
    }
  };

  const handleOnlinePortalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !portalName.trim() || !portalPhone.trim()) return;
    setStatusMsg(null);
    setPortalSuccess(null);
    const patId = generateRecordId('pat');
    const patCode = `WEB-${String(100 + patients.length)}`;
    const srv = services.find((s) => s.id === portalServiceId);
    const docObj = staff.find((s) => s.id === portalDoctorId);
    const now = new Date().toISOString();
    const actor = { uid: userAccount.uid, email: userAccount.email, role: userAccount.role };

    try {
      await saveSubdoc(
        activeOrgId,
        'patients',
        patId,
        {
          patientCode: patCode,
          fullName: portalName.trim(),
          gender: 'Other',
          mobile: portalPhone.trim(),
          referralSource: 'Online Booking Portal',
          status: 'active',
          createdAt: now,
        },
        actor,
        'ONLINE_PORTAL_PATIENT',
        `Online booking visitor ${portalName.trim()} (${patCode})`
      );

      const aptId = generateRecordId('apt');
      const aptCode = `WEB-${String(501 + appointments.length)}`;
      await saveSubdoc(
        activeOrgId,
        'appointments',
        aptId,
        {
          appointmentCode: aptCode,
          patientId: patId,
          patientName: portalName.trim(),
          doctorId: portalDoctorId || staff.find((s) => s.role === 'dentist')?.id || 'unassigned',
          doctorName: docObj?.fullName || 'Any Available Dentist',
          serviceId: portalServiceId || undefined,
          serviceName: srv?.name || 'Consultation Request',
          date: portalDate,
          startTime: portalTime,
          endTime: portalTime,
          source: 'Website',
          status: 'Pending Confirmation',
          createdBy: userAccount.uid,
          createdAt: now,
        },
        actor,
        'ONLINE_PORTAL_BOOKING',
        `Submitted online booking request ${aptCode} for ${portalDate} ${portalTime}`
      );

      setPortalSuccess(`Booking request ${aptCode} submitted for reception confirmation.`);
      setPortalName('');
      setPortalPhone('');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to submit online booking request.');
    }
  };

  if (view === 'reports') {
    const totalBilled = invoices.reduce((s, i) => s + i.grandTotal, 0);
    const totalCollected = invoices.reduce((s, i) => s + i.paidAmount, 0);
    const totalOutstanding = invoices.reduce((s, i) => s + i.balanceDue, 0);
    const totalExpenses = journals.filter((j) => j.voucherType === 'Expense').reduce((s, j) => s + j.totalDebit, 0);

    return (
      <div className="space-y-6 print-a4-sheet">
        <PrintLetterhead
          clinicConfig={orgConfig}
          documentTitle="Executive Financial & Clinic Intelligence Report"
          preparedBy={userAccount?.displayName}
          metadataPairs={[
            { label: 'Billed', value: formatPKR(totalBilled) },
            { label: 'Collected', value: formatPKR(totalCollected) },
            { label: 'Receivables', value: formatPKR(totalOutstanding) },
            { label: 'Expenses', value: formatPKR(totalExpenses) },
          ]}
        />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Reports &amp; Clinic Intelligence</h1>
            <p className="text-sm text-slate-500">Database-reconciled financial, clinical, appointment, and AI call exports</p>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Summary (A4)</span>
            </button>
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `tawakal-invoices-${activeOrgId}.csv`,
                  ['InvoiceNumber', 'Patient', 'GrandTotalPKR', 'PaidPKR', 'BalanceDuePKR', 'Status', 'CreatedAt'],
                  invoices.map((i) => [i.invoiceNumber, i.patientName || '', i.grandTotal, i.paidAmount, i.balanceDue, i.status, i.createdAt])
                )
              }
              className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Invoices CSV</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print-avoid-break">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Total Billed Revenue</p>
            <p className="text-xl font-semibold text-slate-900 font-mono tabular-nums mt-1">{formatPKR(totalBilled)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Total Cash &amp; Bank Collected</p>
            <p className="text-xl font-semibold text-emerald-700 font-mono tabular-nums mt-1">{formatPKR(totalCollected)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Patient Receivables</p>
            <p className="text-xl font-semibold text-amber-700 font-mono tabular-nums mt-1">{formatPKR(totalOutstanding)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Posted Operating Expenses</p>
            <p className="text-xl font-semibold text-slate-900 font-mono tabular-nums mt-1">{formatPKR(totalExpenses)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs print-avoid-break">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <span>Appointments Report</span>
            </div>
            <p className="text-slate-600">Total: {appointments.length} · Completed: {appointments.filter((a) => a.status === 'Completed').length} · No-Show: {appointments.filter((a) => a.status === 'No Show').length}</p>
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `tawakal-appointments-${activeOrgId}.csv`,
                  ['Code', 'Date', 'Start', 'Patient', 'Doctor', 'Service', 'Status'],
                  appointments.map((a) => [a.appointmentCode, a.date, a.startTime, a.patientName || '', a.doctorName || '', a.serviceName || '', a.status])
                )
              }
              className="text-blue-600 font-medium hover:underline cursor-pointer no-print"
            >
              Download Appointments CSV
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <BarChart3 className="w-4 h-4 text-teal-600" />
              <span>Inventory Valuation Report</span>
            </div>
            <p className="text-slate-600">Items Tracked: {inventory.length} · Low Stock: {inventory.filter((i) => i.currentStock <= i.minStock).length}</p>
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `tawakal-inventory-${activeOrgId}.csv`,
                  ['SKU', 'Name', 'Category', 'Stock', 'MinStock', 'Unit', 'Expiry'],
                  inventory.map((i) => [i.sku, i.name, i.category, i.currentStock, i.minStock, i.unit, i.expiryDate || ''])
                )
              }
              className="text-blue-600 font-medium hover:underline cursor-pointer no-print"
            >
              Download Inventory CSV
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <span>AI Calling Analytics</span>
            </div>
            <p className="text-slate-600">Calls: {callRecords.length} · Emergency Escalations: {callRecords.filter((c) => c.emergencyFlag).length}</p>
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `tawakal-ai-calls-${activeOrgId}.csv`,
                  ['Code', 'Direction', 'Number', 'Language', 'Intent', 'Outcome', 'EmergencyFlag'],
                  callRecords.map((c) => [c.callCode, c.direction, c.callerNumber, c.language || '', c.intent || '', c.outcome, String(c.emergencyFlag)])
                )
              }
              className="text-blue-600 font-medium hover:underline cursor-pointer no-print"
            >
              Download AI Call Logs CSV
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'audit') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Immutable Security &amp; Clinical Audit Trail</h1>
          <p className="text-sm text-slate-500">Every clinical, financial, and user access mutation is logged and protected against deletion</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No audit entries recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">{log.timestamp.slice(0, 19).replace('T', ' ')}</td>
                      <td className="py-2.5 px-4">
                        <span className="font-medium text-slate-900">{log.actorEmail}</span>
                        <span className="text-slate-500 ml-1">({log.actorRole})</span>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-medium text-blue-700">{log.action}</td>
                      <td className="py-2.5 px-4 text-slate-700">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (view === 'patient_portal') {
    const doctors = staff.filter((s) => s.role === 'dentist' && s.isActive);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Public Clinic Website &amp; Online Booking Portal</h1>
          <p className="text-sm text-slate-500">Publishes clinic-approved details only · Never exposes private patient EHR records</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Globe className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-slate-900">{orgConfig?.clinicName || 'Tawakal Dental Clinic'}</h2>
            </div>
            <p className="text-xs text-slate-600">
              Location: {orgConfig?.location || 'Saudabad, Malir, Karachi, Pakistan'}
              <br />
              Hours: {orgConfig?.openingHours || 'Hours to be verified by Clinic Owner'}
            </p>
            <div>
              <h3 className="text-xs font-semibold text-slate-800 mb-2">Approved Services</h3>
              {services.length === 0 ? (
                <p className="text-xs text-slate-500">Services not yet published by Clinic Owner.</p>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {services.filter((s) => s.isActive).map((s) => (
                    <div key={s.id} className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-slate-800">{s.name}</span>
                      <span className="font-mono font-medium text-slate-900">{formatPKR(s.standardPrice)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Request Online Appointment</h3>
            {portalSuccess && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{portalSuccess}</span>
              </div>
            )}
            <form onSubmit={handleOnlinePortalSubmit} className="space-y-3 text-xs">
              <input required value={portalName} onChange={(e) => setPortalName(e.target.value)} placeholder="Patient Full Name *" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <input required value={portalPhone} onChange={(e) => setPortalPhone(e.target.value)} placeholder="Mobile / WhatsApp Number *" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <div className="grid grid-cols-2 gap-2">
                <select value={portalServiceId} onChange={(e) => setPortalServiceId(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="">Select Service...</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <select value={portalDoctorId} onChange={(e) => setPortalDoctorId(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="">Any Available Dentist</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.fullName}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={portalDate} onChange={(e) => setPortalDate(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
                <input type="time" value={portalTime} onChange={(e) => setPortalTime(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
              </div>
              <button type="submit" className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer">
                Submit Booking Request
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Settings, RBAC & Backup
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Administration, RBAC &amp; Disaster Recovery</h1>
          <p className="text-sm text-slate-500">Clinic configuration, environment separation, user permissions, and verified JSON backups</p>
        </div>
        <button
          type="button"
          onClick={onOpenWizard}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer self-start sm:self-auto"
        >
          Open Clinic Setup Wizard
        </button>
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">{statusMsg}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Environment Control */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">Production vs Isolated Demo Environment</h3>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Production (<code className="font-mono">tawakal-prod</code>) and Demo (<code className="font-mono">tawakal-demo</code>) databases are strictly separated. Synthetic demo records are never copied into Production.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {userAccount?.orgId === PROD_ORG_ID && (
              <button
                type="button"
                onClick={() => switchEnvironment(PROD_ORG_ID)}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg border cursor-pointer ${
                  !isDemoMode ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Use Production Clinic
              </button>
            )}
            <button
              type="button"
              onClick={() => switchEnvironment(DEMO_ORG_ID)}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg border cursor-pointer ${
                isDemoMode ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-700 border-slate-300'
              }`}
            >
              Switch to Demo Mode
            </button>
            <button
              type="button"
              onClick={loadDemoData}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Seed / Reset Demo Data</span>
            </button>
          </div>
        </div>

        {/* Backup & Recovery */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DatabaseBackup className="w-4 h-4 text-teal-600" />
              <h3 className="text-sm font-semibold text-slate-900">Data Backup &amp; Recovery Verification</h3>
            </div>
            <button
              type="button"
              disabled={backingUp}
              onClick={handleBackupSnapshot}
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {backingUp ? 'Exporting...' : 'Create & Download Snapshot'}
            </button>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto text-xs">
            {backups.length === 0 ? (
              <p className="text-slate-500">No backup snapshots verified yet.</p>
            ) : (
              backups.map((b) => (
                <div key={b.id} className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-800">{b.label}</span>
                  <span className="font-mono text-slate-500 tabular-nums">{b.recordCount} records · {b.status}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Owner Role & User Access Management */}
      {isOwner && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">Staff Accounts &amp; Role-Based Access Control (RBAC)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">User / Email</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Workspace</th>
                  <th className="py-2.5 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersList.map((u) => (
                  <tr key={u.uid}>
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900">{u.displayName}</p>
                      <p className="text-[11px] text-slate-500">{u.email}</p>
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={u.role}
                        onChange={async (e) => {
                          try {
                            const nextRole = e.target.value as UserRole;
                            await updateUserAccountRole(u.uid, nextRole, u.orgId, u.isActive, {
                              uid: userAccount!.uid,
                              email: userAccount!.email,
                              role: userAccount!.role,
                            });
                            setUsersList((prev) => prev.map((row) => (row.uid === u.uid ? { ...row, role: nextRole } : row)));
                            setStatusMsg(`Updated role for ${u.email} to ${ROLE_LABELS[nextRole]}.`);
                          } catch (err) {
                            setStatusMsg(err instanceof Error ? err.message : 'Failed to update staff role.');
                          }
                        }}
                        className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                      >
                        {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">{u.orgId}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const nextActive = !u.isActive;
                            await updateUserAccountRole(u.uid, u.role, u.orgId, nextActive, {
                              uid: userAccount!.uid,
                              email: userAccount!.email,
                              role: userAccount!.role,
                            });
                            setUsersList((prev) => prev.map((row) => (row.uid === u.uid ? { ...row, isActive: nextActive } : row)));
                            setStatusMsg(`${nextActive ? 'Activated' : 'Deactivated'} account ${u.email}.`);
                          } catch (err) {
                            setStatusMsg(err instanceof Error ? err.message : 'Failed to update staff account status.');
                          }
                        }}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                          u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Deactivated'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
