import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CreditCard,
  FileText,
  Plus,
  Search,
  Stethoscope,
  UserPlus,
  X,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { generateRecordId, saveSubdoc } from '../lib/firestore-service';
import { canPerformClinicalAction } from '../lib/rbac';
import { formatPKR } from '../lib/erp-engine';
import { Patient } from '../types/erp';

export function PatientsView() {
  const {
    activeOrgId,
    userAccount,
    patients,
    staff,
    appointments,
    clinicalNotes,
    treatmentPlans,
    invoices,
    selectedPatientId,
    setSelectedPatientId,
    setActiveModule,
  } = useErp();

  const [search, setSearch] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [profileTab, setProfileTab] = useState<'overview' | 'medical' | 'appointments' | 'clinical' | 'billing'>('overview');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fullName: '',
    guardianName: '',
    dob: '',
    gender: 'Male' as 'Male' | 'Female' | 'Other',
    mobile: '',
    whatsapp: '',
    email: '',
    cnic: '',
    address: '',
    city: 'Karachi',
    emergencyContact: '',
    referralSource: 'Walk-in',
    assignedDoctorId: '',
    allergies: '',
    medicalConditions: '',
    currentMedications: '',
    medicalAlerts: '',
    consentSigned: true,
  });

  const role = userAccount?.role || 'receptionist';
  const canViewClinical = canPerformClinicalAction(role, 'view');
  const doctors = staff.filter((s) => s.role === 'dentist' && s.isActive);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.patientCode.toLowerCase().includes(q) ||
        p.mobile.toLowerCase().includes(q) ||
        (p.cnic || '').toLowerCase().includes(q)
    );
  }, [patients, search]);

  const activePatient = useMemo(
    () => patients.find((p) => p.id === selectedPatientId) || null,
    [patients, selectedPatientId]
  );

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    if (!form.fullName.trim() || !form.mobile.trim()) {
      setError('Full name and mobile number are required.');
      return;
    }

    setSaving(true);
    setError(null);
    const id = generateRecordId('pat');
    const code = `TDC-${String(1001 + patients.length)}`;
    const now = new Date().toISOString();

    const payload: Omit<Patient, 'id'> = {
      patientCode: code,
      fullName: form.fullName.trim(),
      guardianName: form.guardianName.trim() || undefined,
      dob: form.dob || undefined,
      gender: form.gender,
      mobile: form.mobile.trim(),
      whatsapp: (form.whatsapp || form.mobile).trim(),
      email: form.email.trim() || undefined,
      cnic: form.cnic.trim() || undefined,
      address: form.address.trim() || undefined,
      city: form.city.trim() || 'Karachi',
      emergencyContact: form.emergencyContact.trim() || undefined,
      referralSource: form.referralSource,
      assignedDoctorId: form.assignedDoctorId || undefined,
      allergies: canViewClinical ? form.allergies.trim() || undefined : undefined,
      medicalConditions: canViewClinical ? form.medicalConditions.trim() || undefined : undefined,
      currentMedications: canViewClinical ? form.currentMedications.trim() || undefined : undefined,
      medicalAlerts: canViewClinical ? form.medicalAlerts.trim() || undefined : undefined,
      consentSigned: form.consentSigned,
      status: 'active',
      createdAt: now,
    };

    try {
      await saveSubdoc(
        activeOrgId,
        'patients',
        id,
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'REGISTER_PATIENT',
        `Registered patient ${code} (${payload.fullName})`
      );
      setSelectedPatientId(id);
      setShowRegister(false);
      setForm({
        fullName: '',
        guardianName: '',
        dob: '',
        gender: 'Male',
        mobile: '',
        whatsapp: '',
        email: '',
        cnic: '',
        address: '',
        city: 'Karachi',
        emergencyContact: '',
        referralSource: 'Walk-in',
        assignedDoctorId: '',
        allergies: '',
        medicalConditions: '',
        currentMedications: '',
        medicalAlerts: '',
        consentSigned: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register patient.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Patient Directory &amp; Profiles</h1>
          <p className="text-sm text-slate-500">Centralized patient registry with role-restricted medical records</p>
        </div>

        <button
          type="button"
          onClick={() => setShowRegister(true)}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2 cursor-pointer self-start sm:self-auto whitespace-nowrap"
        >
          <UserPlus className="w-4 h-4" />
          <span>Register New Patient</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Directory Table */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by Name, TDC ID, Phone, or CNIC..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {filteredPatients.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-slate-700">No patients found</p>
                <p className="text-xs text-slate-500 mt-1">Register a new patient to create their EHR and billing ledger.</p>
              </div>
            ) : (
              filteredPatients.map((p) => {
                const selected = activePatient?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPatientId(p.id)}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors cursor-pointer ${
                      selected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{p.fullName}</p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        {p.patientCode} · {p.mobile}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 shrink-0">{p.gender}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right 360 Patient Profile */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {!activePatient ? (
            <div className="h-full min-h-[380px] flex flex-col items-center justify-center p-8 text-center">
              <FileText className="w-8 h-8 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-700">Select a patient to view full profile</p>
              <p className="text-xs text-slate-500 mt-1">Demographics, medical alerts, dental chart, and billing statement</p>
            </div>
          ) : (
            <div>
              {/* Patient Header */}
              <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">{activePatient.fullName}</h2>
                    <span className="text-xs font-mono text-slate-500">{activePatient.patientCode}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activePatient.gender} · Mobile: {activePatient.mobile} · {activePatient.city || 'Karachi'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canViewClinical && (
                    <button
                      type="button"
                      onClick={() => setActiveModule('odontogram')}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Stethoscope className="w-3.5 h-3.5" />
                      <span>Open Dental Chart</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveModule('appointments')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Book Visit</span>
                  </button>
                </div>
              </div>

              {/* Profile Tabs */}
              <div className="px-5 pt-3 border-b border-slate-200 flex items-center gap-5 overflow-x-auto text-xs font-medium">
                {(['overview', 'medical', 'appointments', 'clinical', 'billing'] as const).map((tab) => {
                  if ((tab === 'medical' || tab === 'clinical') && !canViewClinical) return null;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setProfileTab(tab)}
                      className={`pb-2.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                        profileTab === tab
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {tab === 'overview'
                        ? 'Overview'
                        : tab === 'medical'
                        ? 'Medical Alerts'
                        : tab === 'appointments'
                        ? 'Appointments'
                        : tab === 'clinical'
                        ? 'Notes & Plans'
                        : 'Billing Ledger'}
                    </button>
                  );
                })}
              </div>

              <div className="p-5">
                {profileTab === 'overview' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-slate-500">Father / Guardian</p>
                      <p className="font-medium text-slate-900 mt-0.5">{activePatient.guardianName || '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">CNIC</p>
                      <p className="font-mono text-slate-900 mt-0.5">{activePatient.cnic || '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">WhatsApp</p>
                      <p className="font-mono text-slate-900 mt-0.5">{activePatient.whatsapp || activePatient.mobile}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Emergency Contact</p>
                      <p className="font-medium text-slate-900 mt-0.5">{activePatient.emergencyContact || '—'}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-slate-500">Address</p>
                      <p className="font-medium text-slate-900 mt-0.5">{activePatient.address || '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Referral Source</p>
                      <p className="font-medium text-slate-900 mt-0.5">{activePatient.referralSource || '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Consent Recorded</p>
                      <p className="font-medium text-slate-900 mt-0.5">{activePatient.consentSigned ? 'Signed' : 'Pending'}</p>
                    </div>
                  </div>
                )}

                {profileTab === 'medical' && canViewClinical && (
                  <div className="space-y-4 text-xs">
                    {activePatient.medicalAlerts && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-red-800">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">Clinical Alert</p>
                          <p>{activePatient.medicalAlerts}</p>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <p className="text-slate-500">Allergies</p>
                        <p className="font-medium text-slate-900 mt-1">{activePatient.allergies || 'None recorded'}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <p className="text-slate-500">Medical Conditions</p>
                        <p className="font-medium text-slate-900 mt-1">{activePatient.medicalConditions || 'None recorded'}</p>
                      </div>
                      <div className="sm:col-span-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <p className="text-slate-500">Current Medications</p>
                        <p className="font-medium text-slate-900 mt-1">{activePatient.currentMedications || 'None recorded'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {profileTab === 'appointments' && (
                  <div className="space-y-2">
                    {appointments.filter((a) => a.patientId === activePatient.id).length === 0 ? (
                      <p className="text-xs text-slate-500">No appointments recorded for this patient.</p>
                    ) : (
                      appointments
                        .filter((a) => a.patientId === activePatient.id)
                        .map((apt) => (
                          <div key={apt.id} className="p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                            <div>
                              <p className="font-medium text-slate-900">{apt.serviceName || 'Consultation'}</p>
                              <p className="text-slate-500 tabular-nums">
                                {apt.date} · {apt.startTime}–{apt.endTime} · {apt.doctorName}
                              </p>
                            </div>
                            <span className="font-medium text-slate-700">{apt.status}</span>
                          </div>
                        ))
                    )}
                  </div>
                )}

                {profileTab === 'clinical' && canViewClinical && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-700">Treatment Plans</h4>
                    {treatmentPlans.filter((t) => t.patientId === activePatient.id).length === 0 ? (
                      <p className="text-xs text-slate-500">No treatment plans yet.</p>
                    ) : (
                      treatmentPlans
                        .filter((t) => t.patientId === activePatient.id)
                        .map((tp) => (
                          <div key={tp.id} className="p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                            <div>
                              <p className="font-medium text-slate-900">{tp.title}</p>
                              <p className="text-slate-500">{tp.planCode} · {tp.status}</p>
                            </div>
                            <span className="font-mono font-medium text-slate-900 tabular-nums">
                              {formatPKR(tp.netEstimated || tp.totalEstimated)}
                            </span>
                          </div>
                        ))
                    )}

                    <h4 className="text-xs font-semibold text-slate-700 pt-2">Clinical Notes &amp; Prescriptions</h4>
                    {clinicalNotes.filter((n) => n.patientId === activePatient.id).length === 0 ? (
                      <p className="text-xs text-slate-500">No clinical notes signed yet.</p>
                    ) : (
                      clinicalNotes
                        .filter((n) => n.patientId === activePatient.id)
                        .map((note) => (
                          <div key={note.id} className="p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-900 capitalize">{note.noteType}</span>
                              <span className="text-slate-500">{note.createdAt.slice(0, 10)}</span>
                            </div>
                            {note.diagnosis && <p className="text-slate-700">Diagnosis: {note.diagnosis}</p>}
                            {note.findings && <p className="text-slate-600">{note.findings}</p>}
                          </div>
                        ))
                    )}
                  </div>
                )}

                {profileTab === 'billing' && (
                  <div className="space-y-2">
                    {invoices.filter((i) => i.patientId === activePatient.id).length === 0 ? (
                      <div className="text-xs text-slate-500 flex items-center justify-between">
                        <span>No invoices recorded for this patient.</span>
                        <button
                          type="button"
                          onClick={() => setActiveModule('billing')}
                          className="text-blue-600 font-medium cursor-pointer flex items-center gap-1"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>Create Invoice</span>
                        </button>
                      </div>
                    ) : (
                      invoices
                        .filter((i) => i.patientId === activePatient.id)
                        .map((inv) => (
                          <div key={inv.id} className="p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                            <div>
                              <p className="font-mono font-medium text-slate-900">{inv.invoiceNumber}</p>
                              <p className="text-slate-500">
                                Total {formatPKR(inv.grandTotal)} · Paid {formatPKR(inv.paidAmount)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-mono font-semibold text-slate-900 tabular-nums">
                                Due {formatPKR(inv.balanceDue)}
                              </p>
                              <p className="text-slate-500">{inv.status}</p>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Register Modal */}
      {showRegister && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl shadow-lg my-8 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Register New Patient</h3>
              <button onClick={() => setShowRegister(false)} className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRegister} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">{error}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
                  <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Father / Guardian Name</label>
                  <input value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mobile Number *</label>
                  <input required value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="03xx-xxxxxxx" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">WhatsApp Number</label>
                  <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="Same as mobile if blank" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Gender *</label>
                  <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as 'Male' | 'Female' | 'Other' })} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Date of Birth</label>
                  <input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">CNIC (Optional)</label>
                  <input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="42101-xxxxxxx-x" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Assigned Dentist</label>
                  <select value={form.assignedDoctorId} onChange={(e) => setForm({ ...form, assignedDoctorId: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="">Unassigned</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.fullName}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Address (Karachi)</label>
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Area / Street, Saudabad, Malir" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>

              {canViewClinical && (
                <div className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Allergies (Restricted Clinical)</label>
                    <input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} placeholder="e.g. Penicillin, Latex" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Medical Conditions</label>
                    <input value={form.medicalConditions} onChange={(e) => setForm({ ...form, medicalConditions: e.target.value })} placeholder="e.g. Diabetes, Hypertension" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Medical Alerts</label>
                    <input value={form.medicalAlerts} onChange={(e) => setForm({ ...form, medicalAlerts: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setShowRegister(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                  <Plus className="w-3.5 h-3.5" />
                  <span>{saving ? 'Registering...' : 'Save Patient'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
