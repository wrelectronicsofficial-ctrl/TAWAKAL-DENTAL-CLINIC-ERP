import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, FlaskConical, Lock, Plus, Printer } from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { PrintLetterhead } from '../components/PrintLetterhead';
import { generateRecordId, saveSubdoc } from '../lib/firestore-service';
import { canPerformClinicalAction } from '../lib/rbac';
import { formatPKR } from '../lib/erp-engine';
import { ClinicalNote, LabCase, PrescriptionLine, TreatmentPlan, TreatmentPlanItem } from '../types/erp';

export function ClinicalRecordsView({ defaultTab = 'notes' }: { defaultTab?: 'notes' | 'plans' | 'lab' }) {
  const {
    activeOrgId,
    userAccount,
    orgConfig,
    patients,
    staff,
    services,
    clinicalNotes,
    treatmentPlans,
    labCases,
    selectedPatientId,
    setSelectedPatientId,
  } = useErp();

  const [tab, setTab] = useState<'notes' | 'plans' | 'lab'>(defaultTab);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = userAccount?.role || 'receptionist';
  const canApproveClinical = canPerformClinicalAction(role, 'approve');
  const doctors = staff.filter((s) => s.role === 'dentist' && s.isActive);
  const activePatientId = selectedPatientId || patients[0]?.id || '';
  const activePatient = patients.find((p) => p.id === activePatientId) || null;

  // Note / Prescription state
  const [noteType, setNoteType] = useState<'examination' | 'progress' | 'prescription' | 'perio'>('examination');
  const [noteDoctorId, setNoteDoctorId] = useState(doctors[0]?.id || '');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [findings, setFindings] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [rxMedicine, setRxMedicine] = useState('');
  const [rxStrength, setRxStrength] = useState('');
  const [rxFreq, setRxFreq] = useState('1+0+1');
  const [rxDays, setRxDays] = useState('5 days');
  const [rxLines, setRxLines] = useState<PrescriptionLine[]>([]);

  // Treatment Plan state
  const [planTitle, setPlanTitle] = useState('');
  const [planTooth, setPlanTooth] = useState('');
  const [planServiceName, setPlanServiceName] = useState('');
  const [planPhase, setPlanPhase] = useState('Phase 1');
  const [planCost, setPlanCost] = useState('');
  const [planItems, setPlanItems] = useState<TreatmentPlanItem[]>([]);
  const [planDiscount, setPlanDiscount] = useState('0');
  const [planConsent, setPlanConsent] = useState(true);

  // Lab Case state
  const [labTooth, setLabTooth] = useState('');
  const [labType, setLabType] = useState('Zirconia Crown');
  const [labName, setLabName] = useState('');
  const [labShade, setLabShade] = useState('A2');
  const [labCost, setLabCost] = useState('0');
  const [labDelivery, setLabDelivery] = useState('');

  const handleAddRxLine = () => {
    if (!rxMedicine.trim()) return;
    setRxLines((prev) => [
      ...prev,
      {
        medicine: rxMedicine.trim(),
        strength: rxStrength.trim() || 'Standard',
        dosage: '1 Tab/Cap',
        frequency: rxFreq,
        duration: rxDays,
        instructions: 'After meals',
      },
    ]);
    setRxMedicine('');
    setRxStrength('');
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !activePatientId || !canApproveClinical) return;
    const docId = noteDoctorId || doctors[0]?.id;
    if (!docId) {
      setError('Please add at least one Dentist in Doctors & Staff before signing clinical notes.');
      return;
    }
    setSaving(true);
    setError(null);
    const docObj = doctors.find((d) => d.id === docId);

    const payload: Omit<ClinicalNote, 'id'> = {
      patientId: activePatientId,
      doctorId: docId,
      doctorName: docObj?.fullName || userAccount.displayName,
      noteType,
      chiefComplaint: chiefComplaint.trim() || undefined,
      findings: findings.trim() || undefined,
      diagnosis: diagnosis.trim() || undefined,
      prescriptionJson: rxLines.length ? JSON.stringify(rxLines) : undefined,
      isFinalized: true,
      authorUid: userAccount.uid,
      createdAt: new Date().toISOString(),
    };

    try {
      await saveSubdoc(
        activeOrgId,
        'clinical_notes',
        generateRecordId('note'),
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'SIGN_CLINICAL_NOTE',
        `Finalized ${noteType} note for ${activePatient?.fullName || activePatientId}`
      );
      setChiefComplaint('');
      setFindings('');
      setDiagnosis('');
      setRxLines([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save clinical note.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddPlanItem = () => {
    if (!planServiceName.trim()) return;
    setPlanItems((prev) => [
      ...prev,
      {
        tooth: planTooth.trim() || 'Full Mouth',
        serviceName: planServiceName.trim(),
        phase: planPhase,
        estimatedCost: Math.max(0, Math.round(Number(planCost) || 0)),
        status: 'Proposed',
      },
    ]);
    setPlanTooth('');
    setPlanServiceName('');
    setPlanCost('');
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !activePatientId || !canApproveClinical) return;
    const docId = noteDoctorId || doctors[0]?.id;
    if (!docId || planItems.length === 0) {
      setError('Select a Dentist and add at least one procedure item.');
      return;
    }
    setSaving(true);
    setError(null);
    const docObj = doctors.find((d) => d.id === docId);
    const totalEstimated = planItems.reduce((s, i) => s + i.estimatedCost, 0);
    const discount = Math.min(totalEstimated, Math.max(0, Math.round(Number(planDiscount) || 0)));

    const payload: Omit<TreatmentPlan, 'id'> = {
      planCode: `TP-${String(201 + treatmentPlans.length)}`,
      patientId: activePatientId,
      patientName: activePatient?.fullName || 'Patient',
      doctorId: docId,
      doctorName: docObj?.fullName || userAccount.displayName,
      title: planTitle.trim() || `${activePatient?.fullName} Treatment Plan`,
      status: planConsent ? 'Accepted' : 'Proposed',
      itemsJson: JSON.stringify(planItems),
      totalEstimated,
      discount,
      netEstimated: totalEstimated - discount,
      consentSigned: planConsent,
      createdAt: new Date().toISOString(),
    };

    try {
      await saveSubdoc(
        activeOrgId,
        'treatment_plans',
        generateRecordId('tp'),
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'CREATE_TREATMENT_PLAN',
        `Created treatment plan ${payload.planCode} (${formatPKR(payload.netEstimated || 0)})`
      );
      setPlanTitle('');
      setPlanItems([]);
      setPlanDiscount('0');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save treatment plan.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateLabCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !activePatientId) return;
    const docId = noteDoctorId || doctors[0]?.id || userAccount.uid;
    if (!labName.trim()) {
      setError('Dental laboratory name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const payload: Omit<LabCase, 'id'> = {
      caseCode: `LAB-${String(101 + labCases.length)}`,
      patientId: activePatientId,
      patientName: activePatient?.fullName || 'Patient',
      doctorId: docId,
      toothNumber: labTooth.trim() || undefined,
      restorationType: labType,
      labName: labName.trim(),
      shade: labShade,
      labCost: Math.max(0, Math.round(Number(labCost) || 0)),
      status: 'Sent to Lab',
      expectedDelivery: labDelivery || undefined,
      createdAt: new Date().toISOString(),
    };

    try {
      await saveSubdoc(
        activeOrgId,
        'lab_cases',
        generateRecordId('lab'),
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'CREATE_LAB_CASE',
        `Sent lab case ${payload.caseCode} (${payload.restorationType}) to ${payload.labName}`
      );
      setLabTooth('');
      setLabName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lab case.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLabStatus = async (lc: LabCase, status: LabCase['status']) => {
    if (!userAccount) return;
    await saveSubdoc(
      activeOrgId,
      'lab_cases',
      lc.id,
      { ...lc, status, updatedAt: new Date().toISOString() },
      { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
      'UPDATE_LAB_CASE_STATUS',
      `Lab case ${lc.caseCode} updated to ${status}`
    );
  };

  const printDocTitle =
    tab === 'notes'
      ? 'Clinical Examination & Prescription (Rx)'
      : tab === 'plans'
      ? 'Phased Dental Treatment Plan'
      : 'Dental Laboratory Case Tracker';

  return (
    <div className="space-y-6 print-a4-sheet">
      <PrintLetterhead
        clinicConfig={orgConfig}
        documentTitle={printDocTitle}
        patient={activePatient}
        preparedBy={userAccount?.displayName}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Clinical Documentation &amp; Treatment Planning</h1>
          <p className="text-sm text-slate-500">Dentist-approved examinations, prescriptions, phased plans, and dental lab cases</p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={activePatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white min-w-[200px]"
          >
            {patients.length === 0 ? (
              <option value="">No patients registered</option>
            ) : (
              patients.map((p) => (
                <option key={p.id} value={p.id}>{p.fullName} ({p.patientCode})</option>
              ))
            )}
          </select>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            {([
              ['notes', 'Examinations & Rx'],
              ['plans', 'Treatment Plans'],
              ['lab', 'Lab Cases'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                  tab === key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activePatient?.allergies && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2.5 text-xs text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span>
            <strong>Allergy Warning ({activePatient.fullName}):</strong> {activePatient.allergies}
            {activePatient.medicalAlerts ? ` · ${activePatient.medicalAlerts}` : ''}
          </span>
        </div>
      )}

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 no-print">{error}</div>}

      {tab === 'notes' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 no-print">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Sign Clinical Examination / Prescription</h3>
            {!canApproveClinical ? (
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                <span>Only authorized Dentists or Clinic Owners can create and sign clinical notes or prescriptions.</span>
              </div>
            ) : (
              <form onSubmit={handleSaveNote} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Record Type</label>
                    <select value={noteType} onChange={(e) => setNoteType(e.target.value as ClinicalNote['noteType'])} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                      <option value="examination">Dental Examination</option>
                      <option value="progress">Procedure Progress Note</option>
                      <option value="prescription">Doctor Prescription (Rx)</option>
                      <option value="perio">Periodontal Assessment</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Signing Dentist</label>
                    <select value={noteDoctorId} onChange={(e) => setNoteDoctorId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                      {doctors.length === 0 && <option value="">No active dentist</option>}
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>{d.fullName}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <input
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  placeholder="Chief Complaint (e.g. Pain in lower right molar on hot/cold)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                <textarea
                  rows={2}
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  placeholder="Clinical Findings / Probing measurements / Radiograph review"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="Dentist Diagnosis"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />

                {/* Prescription Builder */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <p className="font-semibold text-slate-800">Prescription Lines (Doctor Approved Only)</p>
                  <div className="grid grid-cols-12 gap-2">
                    <input value={rxMedicine} onChange={(e) => setRxMedicine(e.target.value)} placeholder="Medicine" className="col-span-4 px-2.5 py-1.5 border border-slate-300 rounded bg-white" />
                    <input value={rxStrength} onChange={(e) => setRxStrength(e.target.value)} placeholder="500mg" className="col-span-2 px-2 py-1.5 border border-slate-300 rounded bg-white" />
                    <input value={rxFreq} onChange={(e) => setRxFreq(e.target.value)} placeholder="1+0+1" className="col-span-2 px-2 py-1.5 border border-slate-300 rounded bg-white" />
                    <input value={rxDays} onChange={(e) => setRxDays(e.target.value)} placeholder="5 days" className="col-span-2 px-2 py-1.5 border border-slate-300 rounded bg-white" />
                    <button type="button" onClick={handleAddRxLine} className="col-span-2 bg-slate-900 text-white rounded px-2 py-1.5 font-medium cursor-pointer">
                      Add
                    </button>
                  </div>
                  {rxLines.map((line, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] bg-white px-2.5 py-1.5 rounded border border-slate-200">
                      <span>{line.medicine} {line.strength} · {line.frequency} · {line.duration}</span>
                      <button type="button" onClick={() => setRxLines(rxLines.filter((_, idx) => idx !== i))} className="text-red-600 cursor-pointer">Remove</button>
                    </div>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={saving || !activePatientId}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Finalizing...' : 'Sign & Lock Clinical Record'}
                </button>
              </form>
            )}
          </div>

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3 print-full-width print-a4-sheet">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Signed Clinical History &amp; Prescriptions (Rx)</h3>
              <button type="button" onClick={() => window.print()} className="text-xs text-blue-600 flex items-center gap-1 cursor-pointer no-print">
                <Printer className="w-3.5 h-3.5" /> Print Rx (A4)
              </button>
            </div>
            {clinicalNotes.filter((n) => n.patientId === activePatientId).length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">No signed clinical notes for this patient yet.</p>
            ) : (
              clinicalNotes
                .filter((n) => n.patientId === activePatientId)
                .map((note) => {
                  const rx: PrescriptionLine[] = note.prescriptionJson ? JSON.parse(note.prescriptionJson) : [];
                  return (
                    <div key={note.id} className="p-3.5 rounded-lg border border-slate-200 space-y-1.5 text-xs print-avoid-break">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 capitalize">{note.noteType}</span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {note.createdAt.slice(0, 10)} · {note.doctorName}
                        </span>
                      </div>
                      {note.chiefComplaint && <p className="text-slate-700"><strong>Complaint:</strong> {note.chiefComplaint}</p>}
                      {note.findings && <p className="text-slate-700"><strong>Findings:</strong> {note.findings}</p>}
                      {note.diagnosis && <p className="text-slate-900 font-medium"><strong>Diagnosis:</strong> {note.diagnosis}</p>}
                      {rx.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                          <p className="font-semibold text-slate-800">Rx:</p>
                          {rx.map((r, idx) => (
                            <p key={idx} className="font-mono text-[11px] text-slate-700">
                              {idx + 1}. {r.medicine} ({r.strength}) — {r.frequency} for {r.duration}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </div>
      )}

      {tab === 'plans' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 no-print">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Create Phased Treatment Plan</h3>
            <form onSubmit={handleSavePlan} className="space-y-3 text-xs">
              <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} placeholder="Plan Title (e.g. #16 RCT & Crown Rehabilitation)" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input value={planTooth} onChange={(e) => setPlanTooth(e.target.value)} placeholder="Tooth # (e.g. 16)" className="px-2.5 py-1.5 border border-slate-300 rounded bg-white" />
                  <select value={planPhase} onChange={(e) => setPlanPhase(e.target.value)} className="px-2.5 py-1.5 border border-slate-300 rounded bg-white">
                    <option value="Phase 1">Phase 1</option>
                    <option value="Phase 2">Phase 2</option>
                    <option value="Phase 3">Phase 3</option>
                  </select>
                </div>
                <div className="grid grid-cols-12 gap-2">
                  <select
                    value={planServiceName}
                    onChange={(e) => {
                      const srv = services.find((s) => s.name === e.target.value);
                      setPlanServiceName(e.target.value);
                      if (srv) setPlanCost(String(srv.standardPrice));
                    }}
                    className="col-span-7 px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                  >
                    <option value="">Select configured service...</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.name}>{s.name} ({formatPKR(s.standardPrice)})</option>
                    ))}
                  </select>
                  <input type="number" min={0} value={planCost} onChange={(e) => setPlanCost(e.target.value)} placeholder="PKR" className="col-span-3 px-2 py-1.5 border border-slate-300 rounded bg-white tabular-nums" />
                  <button type="button" onClick={handleAddPlanItem} className="col-span-2 bg-slate-900 text-white rounded px-2 py-1.5 font-medium cursor-pointer">
                    <Plus className="w-3.5 h-3.5 mx-auto" />
                  </button>
                </div>
                {planItems.map((it, i) => (
                  <div key={i} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded border border-slate-200">
                    <span>{it.phase} · #{it.tooth} · {it.serviceName}</span>
                    <span className="font-mono tabular-nums">{formatPKR(it.estimatedCost)}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 items-center">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Discount (PKR)</label>
                  <input type="number" min={0} value={planDiscount} onChange={(e) => setPlanDiscount(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
                </div>
                <label className="flex items-center gap-2 pt-4 cursor-pointer">
                  <input type="checkbox" checked={planConsent} onChange={(e) => setPlanConsent(e.target.checked)} />
                  <span>Patient Informed Consent Signed</span>
                </label>
              </div>

              <button type="submit" disabled={saving || !canApproveClinical} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 cursor-pointer">
                Save Treatment Plan
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-3 print-full-width print-a4-sheet">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Patient Treatment Plans</h3>
              <button type="button" onClick={() => window.print()} className="text-xs text-blue-600 flex items-center gap-1 cursor-pointer no-print">
                <Printer className="w-3.5 h-3.5" /> Print Plan (A4)
              </button>
            </div>
            {treatmentPlans.filter((t) => t.patientId === activePatientId).length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                <ClipboardCheck className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                No treatment plans recorded for this patient.
              </div>
            ) : (
              treatmentPlans
                .filter((t) => t.patientId === activePatientId)
                .map((tp) => {
                  const items: TreatmentPlanItem[] = tp.itemsJson ? JSON.parse(tp.itemsJson) : [];
                  return (
                    <div key={tp.id} className="p-4 rounded-lg border border-slate-200 space-y-2 text-xs print-avoid-break">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">{tp.title}</p>
                          <p className="text-slate-500 font-mono">{tp.planCode} · {tp.status} · {tp.consentSigned ? 'Consent Signed' : 'Pending Consent'}</p>
                        </div>
                        <p className="font-mono font-semibold text-slate-900 tabular-nums">{formatPKR(tp.netEstimated || tp.totalEstimated)}</p>
                      </div>
                      <div className="space-y-1 pt-2 border-t border-slate-100">
                        {items.map((it, idx) => (
                          <div key={idx} className="flex justify-between text-slate-700">
                            <span>{it.phase} · Tooth #{it.tooth} · {it.serviceName}</span>
                            <span className="font-mono tabular-nums">{formatPKR(it.estimatedCost)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      )}

      {tab === 'lab' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 no-print">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">New Crown / Prosthetic Lab Case</h3>
            <form onSubmit={handleCreateLabCase} className="space-y-3 text-xs">
              <input required value={labName} onChange={(e) => setLabName(e.target.value)} placeholder="Laboratory Name *" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <div className="grid grid-cols-2 gap-2">
                <input value={labTooth} onChange={(e) => setLabTooth(e.target.value)} placeholder="Tooth # (e.g. 36)" className="px-3 py-2 border border-slate-300 rounded-lg" />
                <input value={labShade} onChange={(e) => setLabShade(e.target.value)} placeholder="Shade (e.g. A2)" className="px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <select value={labType} onChange={(e) => setLabType(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="Zirconia Crown">Zirconia Crown</option>
                <option value="PFM Crown">PFM Crown</option>
                <option value="E-Max Veneer/Crown">E-Max Crown</option>
                <option value="Acrylic/Cast Partial Denture">Partial Denture</option>
                <option value="Bridge Unit">Dental Bridge</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min={0} value={labCost} onChange={(e) => setLabCost(e.target.value)} placeholder="Lab Cost (PKR)" className="px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
                <input type="date" value={labDelivery} onChange={(e) => setLabDelivery(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
              </div>
              <button type="submit" disabled={saving || !activePatientId} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer">
                Create &amp; Send Lab Case
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden print-full-width print-a4-sheet">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-teal-600" />
                <h3 className="text-sm font-semibold text-slate-900">Dental Laboratory Case Tracker</h3>
              </div>
              <button type="button" onClick={() => window.print()} className="text-xs text-blue-600 flex items-center gap-1 cursor-pointer no-print">
                <Printer className="w-3.5 h-3.5" /> Print Lab Sheet (A4)
              </button>
            </div>
            {labCases.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No laboratory cases recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-4">Case</th>
                      <th className="py-2.5 px-4">Patient / Tooth</th>
                      <th className="py-2.5 px-4">Lab &amp; Restoration</th>
                      <th className="py-2.5 px-4 text-right">Lab Cost</th>
                      <th className="py-2.5 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {labCases.map((lc) => (
                      <tr key={lc.id}>
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">{lc.caseCode}</td>
                        <td className="py-3 px-4">{lc.patientName} {lc.toothNumber ? `(#${lc.toothNumber})` : ''}</td>
                        <td className="py-3 px-4">{lc.labName} · {lc.restorationType} ({lc.shade})</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">{formatPKR(lc.labCost || 0)}</td>
                        <td className="py-3 px-4 text-right">
                          <select
                            value={lc.status}
                            onChange={(e) => handleUpdateLabStatus(lc, e.target.value as LabCase['status'])}
                            className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                          >
                            {['Created', 'Sent to Lab', 'In Progress', 'Received', 'Fitted', 'Rework Required'].map((st) => (
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
        </div>
      )}
    </div>
  );
}
