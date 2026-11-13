import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  CloudUpload,
  FileSpreadsheet,
  Plus,
  Printer,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { PrintLetterhead } from '../components/PrintLetterhead';
import { apiUrl, readJsonSafe } from '../lib/api-client';
import { createAppointmentSafely, saveSubdoc, writeAuditLog } from '../lib/firestore-service';
import { checkAppointmentConflict, computeAvailableSlots, minutesToTime, timeToMinutes } from '../lib/erp-engine';
import { Appointment, AppointmentStatus } from '../types/erp';

const STATUS_ACTIONS: { label: string; next: AppointmentStatus }[] = [
  { label: 'Confirm', next: 'Confirmed' },
  { label: 'Check In', next: 'Waiting' },
  { label: 'Seat in Chair', next: 'In Treatment' },
  { label: 'Complete', next: 'Completed' },
  { label: 'No Show', next: 'No Show' },
  { label: 'Cancel', next: 'Cancelled' },
];

export function AppointmentsView({ defaultMode = 'calendar' }: { defaultMode?: 'calendar' | 'queue' }) {
  const {
    activeOrgId,
    isDemoMode,
    userAccount,
    orgConfig,
    patients,
    staff,
    services,
    appointments,
    setSelectedPatientId,
    setActiveModule,
    getIdToken,
  } = useErp();

  const [mode, setMode] = useState<'calendar' | 'queue'>(defaultMode);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [filterDoctorId, setFilterDoctorId] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<'xlsx' | 'graph' | 'oauth' | null>(null);
  const [exportNotice, setExportNotice] = useState<{ text: string; webUrl?: string | null } | null>(null);
  const [msStatus, setMsStatus] = useState<{ configured: boolean; oauthConnected: boolean } | null>(null);

  const doctors = staff.filter((s) => s.role === 'dentist' && s.isActive);
  const chairsCount = orgConfig?.chairsCount && orgConfig.chairsCount > 0 ? orgConfig.chairsCount : 2;
  const chairList = Array.from({ length: chairsCount }, (_, i) => `Chair ${i + 1}`);

  const [form, setForm] = useState({
    patientId: '',
    doctorId: '',
    serviceId: '',
    chairNumber: 'Chair 1',
    date: new Date().toISOString().slice(0, 10),
    startTime: '11:00',
    durationMin: 30,
    source: 'Reception',
    priority: 'normal' as 'normal' | 'emergency',
    notes: '',
  });

  const endTime = useMemo(() => {
    try {
      return minutesToTime(timeToMinutes(form.startTime) + form.durationMin);
    } catch {
      return '11:30';
    }
  }, [form.startTime, form.durationMin]);

  const conflictCheck = useMemo(() => {
    if (!form.doctorId || !form.date || !form.startTime) return { conflict: false };
    try {
      return checkAppointmentConflict(appointments, {
        doctorId: form.doctorId,
        chairNumber: form.chairNumber,
        date: form.date,
        startTime: form.startTime,
        endTime,
      });
    } catch {
      return { conflict: true, reason: 'Invalid start time format.' };
    }
  }, [appointments, form.doctorId, form.chairNumber, form.date, form.startTime, endTime]);

  const availableSlots = useMemo(() => {
    if (!form.doctorId || !form.date) return [];
    return computeAvailableSlots('09:00', '21:00', form.durationMin, appointments, form.doctorId, form.chairNumber, form.date);
  }, [appointments, form.doctorId, form.chairNumber, form.date, form.durationMin]);

  const dayAppointments = useMemo(() => {
    return appointments
      .filter((a) => a.date === selectedDate)
      .filter((a) => filterDoctorId === 'all' || a.doctorId === filterDoctorId)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [appointments, selectedDate, filterDoctorId]);

  const queueItems = useMemo(() => {
    const activeQueueStatuses = new Set(['Confirmed', 'Checked In', 'Waiting', 'Seated', 'In Treatment']);
    return appointments
      .filter((a) => a.date === selectedDate && activeQueueStatuses.has(a.status))
      .sort((a, b) => {
        if (a.priority === 'emergency' && b.priority !== 'emergency') return -1;
        if (b.priority === 'emergency' && a.priority !== 'emergency') return 1;
        return a.startTime.localeCompare(b.startTime);
      });
  }, [appointments, selectedDate]);

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    if (!form.patientId || !form.doctorId) {
      setError('Please select both a patient and a dentist.');
      return;
    }
    if (conflictCheck.conflict) {
      setError(conflictCheck.reason || 'Scheduling conflict detected.');
      return;
    }

    setSaving(true);
    setError(null);
    const pat = patients.find((p) => p.id === form.patientId);
    const doc = doctors.find((d) => d.id === form.doctorId);
    const srv = services.find((s) => s.id === form.serviceId);
    const now = new Date().toISOString();

    const payload: Omit<Appointment, 'id'> = {
      appointmentCode: `APT-${String(501 + appointments.length)}`,
      patientId: form.patientId,
      patientName: pat?.fullName || 'Patient',
      doctorId: form.doctorId,
      doctorName: doc?.fullName || 'Dentist',
      serviceId: form.serviceId || undefined,
      serviceName: srv?.name || 'Consultation',
      chairNumber: form.chairNumber,
      date: form.date,
      startTime: form.startTime,
      endTime,
      source: form.source,
      status: 'Confirmed',
      priority: form.priority,
      notes: form.notes.trim() || undefined,
      createdBy: userAccount.uid,
      createdAt: now,
    };

    try {
      await createAppointmentSafely(activeOrgId, appointments, payload, {
        uid: userAccount.uid,
        email: userAccount.email,
        role: userAccount.role,
      });
      setSelectedDate(form.date);
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create appointment.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (apt: Appointment, nextStatus: AppointmentStatus) => {
    if (!userAccount) return;
    let queueToken = apt.queueToken;
    if ((nextStatus === 'Waiting' || nextStatus === 'Checked In') && !queueToken) {
      const todayCheckedInCount = appointments.filter((a) => a.date === apt.date && Boolean(a.queueToken)).length;
      queueToken = `Q-${String(todayCheckedInCount + 1).padStart(2, '0')}`;
    }

    await saveSubdoc(
      activeOrgId,
      'appointments',
      apt.id,
      {
        ...apt,
        status: nextStatus,
        queueToken,
        updatedAt: new Date().toISOString(),
      },
      { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
      'UPDATE_APPOINTMENT_STATUS',
      `Updated ${apt.appointmentCode} status to ${nextStatus}${queueToken ? ` (Token ${queueToken})` : ''}`
    );
  };

  const refreshMsStatus = async () => {
    if (!userAccount) return;
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/microsoft/status'), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
      });
      if (res.ok) {
        const data = await readJsonSafe<{ configured: boolean; oauthConnected: boolean }>(res);
        setMsStatus(data);
      }
    } catch {
      // Static hosting or server unavailable; handled explicitly if user clicks export
    }
  };

  useEffect(() => {
    refreshMsStatus();
  }, [userAccount?.uid]);

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      const sameOrigin = typeof window !== 'undefined' && event.origin === window.location.origin;
      if (!sameOrigin && !event.origin.endsWith('.run.app') && !event.origin.includes('localhost')) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'microsoft') {
        setError(null);
        setExportNotice({ text: 'Microsoft Graph OAuth 2.0 connected. You can now sync daily appointments to OneDrive.' });
        refreshMsStatus();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const doctorFilterLabel = useMemo(() => {
    if (filterDoctorId === 'all') return 'All Dentists';
    return doctors.find((d) => d.id === filterDoctorId)?.fullName || 'Selected Dentist';
  }, [filterDoctorId, doctors]);

  const buildDailyExportSnapshot = () => ({
    clinicName: orgConfig?.clinicName || 'Tawakal Dental Clinic',
    environment: isDemoMode ? ('DEMO' as const) : ('PRODUCTION' as const),
    targetDate: selectedDate,
    doctorFilterLabel,
    patients: [],
    appointments: dayAppointments,
    staff: [],
    services: [],
    treatmentPlans: [],
    invoices: [],
    journals: [],
    budgets: [],
    inventory: [],
    sterilizationLogs: [],
    callRecords: [],
  });

  const handleBulkExportDailyExcel = async () => {
    if (!userAccount) return;
    setExportBusy('xlsx');
    setError(null);
    setExportNotice(null);
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/excel/export'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
        body: JSON.stringify({
          domain: 'daily_appointments',
          snapshot: buildDailyExportSnapshot(),
        }),
      });
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res).catch((e) => ({
          error: e instanceof Error ? e.message : 'Daily appointment Excel export failed.',
        }));
        throw new Error(d.error || 'Daily appointment Excel export failed.');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `Tawakal_Dental_Daily_Appointments_${selectedDate}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      await writeAuditLog(
        activeOrgId,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'EXPORT_DAILY_APPOINTMENTS_EXCEL',
        'appointments',
        selectedDate,
        `Bulk-exported ${dayAppointments.length} appointment(s) for ${selectedDate} (${doctorFilterLabel}) to ${filename}`
      );
      setExportNotice({ text: `Exported ${dayAppointments.length} appointment(s) to ${filename}.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Daily appointment Excel export failed.');
    } finally {
      setExportBusy(null);
    }
  };

  const handleConnectMicrosoftGraph = async () => {
    if (!userAccount) return;
    setExportBusy('oauth');
    setError(null);
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/microsoft/auth/url'), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
      });
      const data = await readJsonSafe<{ url?: string; error?: string }>(res);
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Microsoft Graph OAuth is not configured on the server.');
      }
      const popup = window.open(data.url, 'ms_oauth_popup', 'width=620,height=720');
      if (!popup) {
        setError('Sign-in popup blocked by browser. Allow popups to authorize Microsoft Graph OneDrive access.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate Microsoft Graph sign-in.');
    } finally {
      setExportBusy(null);
    }
  };

  const handleSyncDailyExcelToGraph = async () => {
    if (!userAccount) return;
    setExportBusy('graph');
    setError(null);
    setExportNotice(null);
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/microsoft/excel/export-daily-appointments'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
        body: JSON.stringify({
          snapshot: buildDailyExportSnapshot(),
        }),
      });
      const data = await readJsonSafe<{
        synced?: boolean;
        authRequired?: boolean;
        filename?: string;
        drivePath?: string;
        driveItem?: { webUrl?: string | null };
        error?: string;
      }>(res);
      if (!res.ok || !data.synced) {
        if (data.authRequired) {
          await refreshMsStatus();
        }
        throw new Error(data.error || 'Microsoft Graph OneDrive sync failed.');
      }

      await writeAuditLog(
        activeOrgId,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'SYNC_DAILY_APPOINTMENTS_MS_GRAPH',
        'appointments',
        selectedDate,
        `Synced ${dayAppointments.length} appointment(s) for ${selectedDate} to OneDrive (${data.drivePath})`
      );
      setExportNotice({
        text: `Synced ${data.filename} (${dayAppointments.length} appointments) to OneDrive (${data.drivePath}).`,
        webUrl: data.driveItem?.webUrl || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microsoft Graph OneDrive sync failed.');
    } finally {
      setExportBusy(null);
    }
  };

  return (
    <div className="space-y-6 print-a4-sheet">
      <PrintLetterhead
        clinicConfig={orgConfig}
        documentTitle={`Daily Appointment Schedule · ${selectedDate}`}
        subtitle={`${doctorFilterLabel} · ${dayAppointments.length} appointment(s)`}
        preparedBy={userAccount?.displayName}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {mode === 'calendar' ? 'Appointment Scheduling & Calendar' : 'Live Reception & Patient Queue'}
          </h1>
          <p className="text-sm text-slate-500">
            Double-booking protected across dentists and operatories · Queue token tracking
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setMode('calendar')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                mode === 'calendar' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Schedule
            </button>
            <button
              type="button"
              onClick={() => setMode('queue')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                mode === 'queue' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Reception Queue
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>New Appointment</span>
          </button>
        </div>
      </div>

      {/* Filters & Bulk Export Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3 text-xs no-print">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg tabular-nums"
          />
        </div>
        <select
          value={filterDoctorId}
          onChange={(e) => setFilterDoctorId(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">All Dentists ({doctors.length})</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>{d.fullName}</option>
          ))}
        </select>
        <span className="text-slate-500 tabular-nums">
          {dayAppointments.length} appointment(s) on {selectedDate}
        </span>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={handleBulkExportDailyExcel}
            disabled={Boolean(exportBusy)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>{exportBusy === 'xlsx' ? 'Exporting...' : 'Export Daily Excel (.xlsx)'}</span>
          </button>

          {msStatus?.configured && !msStatus.oauthConnected ? (
            <button
              type="button"
              onClick={handleConnectMicrosoftGraph}
              disabled={Boolean(exportBusy)}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>{exportBusy === 'oauth' ? 'Connecting...' : 'Connect Microsoft OneDrive'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSyncDailyExcelToGraph}
              disabled={Boolean(exportBusy)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <CloudUpload className="w-3.5 h-3.5 text-blue-600" />
              <span>{exportBusy === 'graph' ? 'Syncing...' : 'Sync to OneDrive (.xlsx)'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Schedule</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2 no-print">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {exportNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
            <span>{exportNotice.text}</span>
          </div>
          {exportNotice.webUrl && (
            <a
              href={exportNotice.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline text-emerald-900 whitespace-nowrap"
            >
              Open in OneDrive
            </a>
          )}
        </div>
      )}

      {mode === 'calendar' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {dayAppointments.length === 0 ? (
            <div className="p-10 text-center">
              <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-700">No appointments scheduled for {selectedDate}</p>
              <p className="text-xs text-slate-500 mt-1">Click &quot;New Appointment&quot; to schedule a verified conflict-free slot.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-4">Code / Time</th>
                    <th className="py-2.5 px-4">Patient</th>
                    <th className="py-2.5 px-4">Dentist &amp; Chair</th>
                    <th className="py-2.5 px-4">Service</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right no-print">Workflow Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {dayAppointments.map((apt) => (
                    <tr key={apt.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono tabular-nums">
                        <p className="font-medium text-slate-900">{apt.startTime}–{apt.endTime}</p>
                        <p className="text-[11px] text-slate-500">{apt.appointmentCode}</p>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPatientId(apt.patientId);
                            setActiveModule('patients');
                          }}
                          className="font-medium text-blue-600 hover:underline cursor-pointer text-left"
                        >
                          {apt.patientName}
                        </button>
                        <p className="text-[11px] text-slate-500">{apt.source || 'Reception'}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-slate-900">{apt.doctorName}</p>
                        <p className="text-[11px] text-slate-500">{apt.chairNumber || 'Unassigned'}</p>
                      </td>
                      <td className="py-3 px-4 text-slate-700">{apt.serviceName || 'Consultation'}</td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-900">{apt.status}</span>
                        {apt.queueToken && (
                          <p className="text-[11px] font-mono text-teal-700">Token {apt.queueToken}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right no-print">
                        <select
                          value={apt.status}
                          onChange={(e) => handleStatusChange(apt, e.target.value as AppointmentStatus)}
                          className="px-2 py-1 border border-slate-300 rounded bg-white text-xs cursor-pointer"
                        >
                          {['Requested', 'Pending Confirmation', 'Confirmed', 'Checked In', 'Waiting', 'Seated', 'In Treatment', 'Completed', 'Cancelled', 'No Show'].map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Live Queue Desk */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['Waiting', 'In Treatment', 'Completed'] as const).map((col) => {
            const list =
              col === 'Waiting'
                ? queueItems.filter((a) => ['Confirmed', 'Checked In', 'Waiting'].includes(a.status))
                : col === 'In Treatment'
                ? queueItems.filter((a) => ['Seated', 'In Treatment'].includes(a.status))
                : dayAppointments.filter((a) => a.status === 'Completed');

            return (
              <div key={col} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h3 className="text-sm font-semibold text-slate-900">{col}</h3>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">{list.length}</span>
                </div>
                {list.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No patients in {col.toLowerCase()}</p>
                ) : (
                  list.map((apt) => (
                    <div key={apt.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-slate-900">
                          {apt.queueToken || apt.appointmentCode}
                        </span>
                        {apt.priority === 'emergency' && (
                          <span className="text-red-700 font-semibold flex items-center gap-1">
                            <ShieldAlert className="w-3.5 h-3.5" /> Emergency
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-slate-900">{apt.patientName}</p>
                      <p className="text-slate-500">
                        {apt.doctorName} · {apt.chairNumber} · {apt.startTime}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {STATUS_ACTIONS.filter((sa) => sa.next !== apt.status).slice(0, 3).map((sa) => (
                          <button
                            key={sa.next}
                            type="button"
                            onClick={() => handleStatusChange(apt, sa.next)}
                            className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 rounded text-[11px] font-medium text-slate-700 cursor-pointer"
                          >
                            {sa.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Booking Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto no-print">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl shadow-lg my-8 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-900">Schedule Dental Appointment</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBook} className="p-6 space-y-4 text-xs">
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {doctors.length === 0 || patients.length === 0 ? (
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                  Please register at least one Dentist (in Doctors &amp; Staff) and one Patient (in Patient Directory) before booking an appointment.
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Patient *</label>
                  <select required value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="">Select patient...</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>{p.fullName} ({p.patientCode})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Dentist *</label>
                  <select required value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="">Select dentist...</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.fullName}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Procedure / Service</label>
                  <select
                    value={form.serviceId}
                    onChange={(e) => {
                      const srv = services.find((s) => s.id === e.target.value);
                      setForm({ ...form, serviceId: e.target.value, durationMin: srv?.durationMin || 30 });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">General Consultation</option>
                    {services.filter((s) => s.isActive).map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.durationMin}m)</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Chair / Operatory *</label>
                  <select value={form.chairNumber} onChange={(e) => setForm({ ...form, chairNumber: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    {chairList.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Date *</label>
                  <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Start Time *</label>
                    <input type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg tabular-nums" />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Duration</label>
                    <select value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} className="w-full px-2 py-2 border border-slate-300 rounded-lg bg-white tabular-nums">
                      <option value={15}>15m</option>
                      <option value={30}>30m</option>
                      <option value={45}>45m</option>
                      <option value={60}>60m</option>
                    </select>
                  </div>
                </div>
              </div>

              {form.doctorId && availableSlots.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-slate-500 mb-1.5">Conflict-free slots for selected dentist &amp; chair:</p>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {availableSlots.slice(0, 14).map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setForm({ ...form, startTime: slot })}
                        className={`px-2 py-1 rounded border text-[11px] font-mono cursor-pointer ${
                          form.startTime === slot
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {conflictCheck.conflict && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 font-medium">
                  {conflictCheck.reason}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Booking Source</label>
                  <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="Reception">Reception</option>
                    <option value="Phone">Phone</option>
                    <option value="Walk-in">Walk-in</option>
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="AI Voice Receptionist">AI Voice Receptionist</option>
                    <option value="Website">Website</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as 'normal' | 'emergency' })} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="normal">Routine</option>
                    <option value="emergency">Clinical Emergency (Staff Verified)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Booking Notes</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Chief complaint or procedure notes" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving || conflictCheck.conflict} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 cursor-pointer">
                  {saving ? 'Confirming...' : `Confirm (${form.startTime}–${endTime})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
