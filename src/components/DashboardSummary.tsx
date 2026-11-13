import React, { useMemo } from 'react';
import { CalendarClock, CreditCard, ShieldCheck, Users } from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { formatPKR } from '../lib/erp-engine';

export function DashboardSummary() {
  const { patients, appointments, invoices, backups, syncJobs, userAccount, setActiveModule } = useErp();

  const todayStr = new Date().toISOString().slice(0, 10);
  const canViewSafety = userAccount?.role === 'owner' || userAccount?.role === 'admin';

  const summary = useMemo(() => {
    const dailyInvoices = invoices.filter((inv) => inv.createdAt.startsWith(todayStr));
    const dailyRevenueBilled = dailyInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
    const dailyRevenueCollected = dailyInvoices.reduce((s, i) => s + (i.paidAmount || 0), 0);

    const pendingStatuses = new Set(['Requested', 'Pending Confirmation', 'Confirmed', 'Checked In', 'Waiting', 'Seated']);
    const pendingAppointments = appointments.filter((a) => pendingStatuses.has(a.status));
    const pendingToday = pendingAppointments.filter((a) => a.date === todayStr).length;

    const activePatients = patients.filter((p) => p.status === 'active').length;
    const inChairCount = appointments.filter((a) => a.status === 'In Treatment' || a.status === 'Seated').length;

    const lastVerifiedBackup = backups.find((b) => b.status === 'Verified' || b.status === 'Completed' || b.status === 'Restored') || backups[0] || null;
    const pendingSyncCount = syncJobs.filter((j) => j.status === 'Queued' || j.status === 'Retrying' || j.status === 'Failed').length;

    return {
      dailyRevenueBilled,
      dailyRevenueCollected,
      pendingCount: pendingAppointments.length,
      pendingToday,
      activePatients,
      totalPatients: patients.length,
      inChairCount,
      lastVerifiedBackup,
      pendingSyncCount,
    };
  }, [invoices, appointments, patients, backups, syncJobs, todayStr]);

  return (
    <section aria-label="Dashboard Summary" className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Real-Time Clinic Summary</h2>
          <p className="text-xs text-slate-500">Live Firestore snapshot · {todayStr} · Authoritative ERP figures</p>
        </div>
        {canViewSafety && (
          <button
            type="button"
            onClick={() => setActiveModule('data_safety')}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer self-start sm:self-auto whitespace-nowrap"
          >
            Open Data Safety &amp; Backup Center
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Daily Revenue</span>
            <CreditCard className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{formatPKR(summary.dailyRevenueCollected)}</p>
          <p className="text-xs text-slate-500 tabular-nums">
            Collected today · {formatPKR(summary.dailyRevenueBilled)} billed
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Pending Appointments</span>
            <CalendarClock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{summary.pendingCount}</p>
          <p className="text-xs text-slate-500 tabular-nums">
            {summary.pendingToday} scheduled today · {summary.inChairCount} in chair
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Active Patients</span>
            <Users className="w-4 h-4 text-teal-600" />
          </div>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{summary.activePatients}</p>
          <p className="text-xs text-slate-500 tabular-nums">
            {summary.totalPatients} total registered profiles
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Data Safety &amp; Backups</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900 truncate pt-1">
            {summary.lastVerifiedBackup
              ? `${summary.lastVerifiedBackup.status} (${summary.lastVerifiedBackup.recordCount} rec)`
              : 'No Backup Recorded Yet'}
          </p>
          <p className="text-xs text-slate-500 tabular-nums">
            {summary.lastVerifiedBackup
              ? `${summary.lastVerifiedBackup.createdAt.slice(0, 10)} · ${summary.pendingSyncCount} pending sync`
              : `${summary.pendingSyncCount} pending sync jobs`}
          </p>
        </div>
      </div>
    </section>
  );
}
