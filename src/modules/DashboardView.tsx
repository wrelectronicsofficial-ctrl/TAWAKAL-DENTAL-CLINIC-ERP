import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Calendar,
  CreditCard,
  Package,
  PhoneCall,
  Send,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { formatPKR } from '../lib/erp-engine';
import { DashboardSummary } from '../components/DashboardSummary';

const CHART_COLORS = ['#2563EB', '#0D9488', '#0F172A', '#D97706', '#64748B'];

export function DashboardView({ onOpenWizard }: { onOpenWizard: () => void }) {
  const {
    orgConfig,
    isDemoMode,
    userAccount,
    patients,
    appointments,
    staff,
    services,
    invoices,
    journals,
    inventory,
    callRecords,
    setActiveModule,
    loadDemoData,
    getIdToken,
  } = useErp();

  const [dateFilter, setDateFilter] = useState<'today' | 'month' | 'all'>('month');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStr = new Date().toISOString().slice(0, 7);

  const metrics = useMemo(() => {
    const todayApts = appointments.filter((a) => a.date === todayStr);
    const waitingCount = appointments.filter((a) => a.status === 'Waiting' || a.status === 'Checked In').length;
    const inTreatmentCount = appointments.filter((a) => a.status === 'In Treatment' || a.status === 'Seated').length;

    const filteredInvoices = invoices.filter((inv) => {
      if (dateFilter === 'today') return inv.createdAt.startsWith(todayStr);
      if (dateFilter === 'month') return inv.createdAt.startsWith(monthStr);
      return true;
    });

    const totalBilled = filteredInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
    const totalCollected = filteredInvoices.reduce((s, i) => s + (i.paidAmount || 0), 0);
    const outstandingReceivables = invoices.reduce((s, i) => s + (i.balanceDue || 0), 0);

    const expenseJournals = journals.filter((j) => {
      if (j.voucherType !== 'Expense') return false;
      if (dateFilter === 'today') return j.date === todayStr;
      if (dateFilter === 'month') return j.date.startsWith(monthStr);
      return true;
    });
    const totalExpenses = expenseJournals.reduce((s, j) => s + (j.totalDebit || 0), 0);

    const doctors = staff.filter((s) => s.role === 'dentist' && s.isActive);
    const lowStock = inventory.filter((i) => i.currentStock <= i.minStock);
    const aiBooked = callRecords.filter((c) => Boolean(c.appointmentId)).length;

    return {
      totalPatients: patients.length,
      todayAppointments: todayApts.length,
      waitingCount,
      inTreatmentCount,
      activeDoctors: doctors.length,
      totalBilled,
      totalCollected,
      outstandingReceivables,
      totalExpenses,
      netAccrualResult: totalBilled - totalExpenses,
      lowStockCount: lowStock.length,
      totalCalls: callRecords.length,
      aiBooked,
    };
  }, [appointments, invoices, journals, staff, inventory, callRecords, patients, dateFilter, todayStr, monthStr]);

  const serviceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const apt of appointments) {
      const key = apt.serviceName || 'General Consultation';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [appointments]);

  const financialChartData = useMemo(() => {
    return [
      { label: 'Billed Revenue', amount: metrics.totalBilled },
      { label: 'Cash Collected', amount: metrics.totalCollected },
      { label: 'Expenses', amount: metrics.totalExpenses },
      { label: 'Receivables', amount: metrics.outstandingReceivables },
    ];
  }, [metrics]);

  const handleAskAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuestion.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: aiQuestion,
          metricsSnapshot: {
            environment: isDemoMode ? 'DEMO' : 'PRODUCTION',
            clinicName: orgConfig?.clinicName,
            ...metrics,
            activeServicesCount: services.length,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Assistant request failed');
      setAiAnswer(data.answer);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to query AI assistant');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      await loadDemoData();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Period Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Executive Clinic Overview</h1>
          <p className="text-sm text-slate-500">
            {orgConfig?.clinicName || 'Tawakal Dental Clinic'} · {orgConfig?.location || 'Saudabad, Malir, Karachi'}
            {orgConfig?.openingHours ? ` · ${orgConfig.openingHours}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            {(['today', 'month', 'all'] as const).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setDateFilter(period)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  dateFilter === period ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {period === 'today' ? 'Today' : period === 'month' ? 'This Month' : 'All Time'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Production Setup Prompt (Only shown when Production is unconfigured) */}
      {!isDemoMode && orgConfig && !orgConfig.setupCompleted && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 shrink-0">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Complete Your Real Clinic Configuration</h2>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed max-w-2xl">
                Production database is clean with zero fabricated data. Run the Owner Setup Wizard to record your actual opening hours, dental chair count, and PKR fees for Scaling, RCT, Extraction, and Crowns — or launch the isolated Demo Mode sandbox to evaluate workflows first.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {seeding ? 'Loading Demo...' : 'Launch Isolated Demo Mode'}
            </button>
            <button
              type="button"
              onClick={onOpenWizard}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Start Owner Setup Wizard
            </button>
          </div>
        </div>
      )}

      {/* Real-Time Clinic Dashboard Summary */}
      <DashboardSummary />

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Registered Patients</span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{metrics.totalPatients}</p>
          <p className="text-xs text-slate-500 mt-1">
            {metrics.waitingCount} waiting · {metrics.inTreatmentCount} in chair
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Appointments Today</span>
            <Calendar className="w-4 h-4 text-teal-600" />
          </div>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{metrics.todayAppointments}</p>
          <p className="text-xs text-slate-500 mt-1">
            {appointments.length} total scheduled · {metrics.activeDoctors} active dentists
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Billed Revenue ({dateFilter})</span>
            <CreditCard className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{formatPKR(metrics.totalBilled)}</p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Collected {formatPKR(metrics.totalCollected)} · Due {formatPKR(metrics.outstandingReceivables)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Operations &amp; AI Reception</span>
            <PhoneCall className="w-4 h-4 text-teal-600" />
          </div>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{metrics.totalCalls} calls</p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {metrics.aiBooked} AI bookings · {metrics.lowStockCount} low-stock alerts
          </p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Financial Position (Accrual vs Collections)</h3>
              <p className="text-xs text-slate-500">Calculated strictly from posted invoices and double-entry expense vouchers</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveModule('accounting')}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
            >
              <span>General Ledger</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {invoices.length === 0 && journals.length === 0 ? (
            <div className="h-60 flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 p-6">
              <Activity className="w-7 h-7 text-slate-400 mb-2" />
              <p className="text-sm font-medium text-slate-700">No financial transactions posted yet</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Create a patient invoice or post an accounting expense voucher to populate real revenue and expense metrics.
              </p>
            </div>
          ) : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={financialChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip formatter={(val) => formatPKR(Number(val ?? 0))} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]} fill="#2563EB" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Appointments by Service</h3>
              <p className="text-xs text-slate-500">Live distribution from scheduled appointments</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveModule('appointments')}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
            >
              <span>Calendar</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {serviceBreakdown.length === 0 ? (
            <div className="h-60 flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 p-6">
              <Calendar className="w-7 h-7 text-slate-400 mb-2" />
              <p className="text-sm font-medium text-slate-700">No appointments booked yet</p>
              <button
                type="button"
                onClick={() => setActiveModule('appointments')}
                className="mt-3 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
              >
                Book First Appointment
              </button>
            </div>
          ) : (
            <div className="h-60 flex items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={serviceBreakdown} dataKey="count" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={3}>
                    {serviceBreakdown.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Operational Alerts + AI Executive Assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Operational Alerts &amp; Quick Actions</h3>
            <span className="text-xs text-slate-500">Live clinic checks</span>
          </div>
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2.5">
                <Package className="w-4 h-4 text-amber-600" />
                <span className="text-slate-700 font-medium">
                  {metrics.lowStockCount > 0
                    ? `${metrics.lowStockCount} dental inventory item(s) at or below minimum stock`
                    : 'All tracked inventory items above minimum stock'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveModule('inventory')}
                className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
              >
                Review
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-blue-600" />
                <span className="text-slate-700 font-medium">
                  Outstanding patient receivables: {formatPKR(metrics.outstandingReceivables)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveModule('billing')}
                className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
              >
                Billing
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-teal-600" />
                <span className="text-slate-700 font-medium">
                  Active role: {userAccount?.role.toUpperCase()} · Verified session
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveModule('patients')}
                className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
              >
                Patients
              </button>
            </div>
          </div>
        </div>

        {/* AI Executive Assistant */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Bot className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">AI Clinic Executive Assistant</h3>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Ask operational questions answered strictly from verified live clinic metrics (never diagnoses or prescribes).
            </p>
          </div>

          {aiError && (
            <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{aiError}</div>
          )}

          {aiAnswer && (
            <div className="mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
              {aiAnswer}
            </div>
          )}

          <form onSubmit={handleAskAssistant} className="flex items-center gap-2">
            <input
              type="text"
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              placeholder="e.g. Aaj kitni bookings hain aur kitna balance pending hai?"
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
            <button
              type="submit"
              disabled={aiLoading}
              className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{aiLoading ? 'Analyzing...' : 'Ask'}</span>
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
