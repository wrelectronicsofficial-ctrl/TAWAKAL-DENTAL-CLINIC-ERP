import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AlertCircle, Check, Lock, Printer, Save, Stethoscope } from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { PrintLetterhead } from '../components/PrintLetterhead';
import { db } from '../lib/firebase';
import { FDI_PERMANENT_QUADRANTS, FDI_PRIMARY_QUADRANTS } from '../lib/erp-engine';
import { saveOdontogram } from '../lib/firestore-service';
import { canPerformClinicalAction } from '../lib/rbac';
import { OdontogramRecord, ToothCondition, ToothState, ToothSurface } from '../types/erp';

const CONDITIONS: { name: ToothCondition; color: string; bg: string }[] = [
  { name: 'Healthy', color: '#CBD5E1', bg: 'bg-slate-100 text-slate-700' },
  { name: 'Caries', color: '#DC2626', bg: 'bg-red-100 text-red-800' },
  { name: 'Restored', color: '#2563EB', bg: 'bg-blue-100 text-blue-800' },
  { name: 'Crown', color: '#D97706', bg: 'bg-amber-100 text-amber-800' },
  { name: 'Root Canal Treated', color: '#7C3AED', bg: 'bg-violet-100 text-violet-800' },
  { name: 'Extraction Planned', color: '#EA580C', bg: 'bg-orange-100 text-orange-800' },
  { name: 'Extraction Completed', color: '#475569', bg: 'bg-slate-200 text-slate-700' },
  { name: 'Missing', color: '#94A3B8', bg: 'bg-slate-100 text-slate-500' },
];

const SURFACES: { code: ToothSurface; label: string }[] = [
  { code: 'M', label: 'Mesial' },
  { code: 'D', label: 'Distal' },
  { code: 'O', label: 'Occlusal' },
  { code: 'B', label: 'Buccal' },
  { code: 'L', label: 'Lingual' },
];

function ToothSvg({
  toothId,
  state,
  selected,
  onClick,
}: {
  toothId: string;
  state?: ToothState;
  selected: boolean;
  onClick: () => void;
}) {
  const cond = state?.condition || 'Healthy';
  const condMeta = CONDITIONS.find((c) => c.name === cond) || CONDITIONS[0];
  const isMissing = cond === 'Missing' || cond === 'Extraction Completed';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center p-1.5 rounded-lg border transition-colors cursor-pointer ${
        selected ? 'border-blue-600 bg-blue-50/80 ring-2 ring-blue-600/20' : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <svg viewBox="0 0 40 52" className="w-8 h-10">
        {isMissing ? (
          <path
            d="M12 12 C12 6, 28 6, 28 12 L26 42 C24 46, 22 36, 20 32 C18 36, 16 46, 14 42 Z"
            fill="none"
            stroke="#94A3B8"
            strokeWidth="1.5"
            strokeDasharray="3 2"
          />
        ) : (
          <>
            <path
              d="M10 16 C10 7, 30 7, 30 16 L28 32 C27 42, 23 47, 22 42 L20 32 L18 42 C17 47, 13 42, 12 32 Z"
              fill={cond === 'Healthy' ? '#FFFFFF' : condMeta.color}
              fillOpacity={cond === 'Healthy' ? 1 : 0.22}
              stroke={cond === 'Healthy' ? '#64748B' : condMeta.color}
              strokeWidth="1.6"
            />
            {cond === 'Root Canal Treated' && (
              <line x1="20" y1="14" x2="20" y2="40" stroke="#7C3AED" strokeWidth="2.2" strokeLinecap="round" />
            )}
            {cond === 'Crown' && (
              <rect x="11" y="9" width="18" height="14" rx="4" fill="#D97706" fillOpacity="0.45" stroke="#B45309" strokeWidth="1.2" />
            )}
            {state?.surfaces && state.surfaces.length > 0 && (
              <circle cx="20" cy="18" r="4" fill={condMeta.color} />
            )}
          </>
        )}
      </svg>
      <span className="text-[11px] font-mono font-semibold text-slate-800 tabular-nums mt-0.5">{toothId}</span>
      <span className="text-[9px] text-slate-500 truncate max-w-[38px]">
        {cond === 'Healthy' ? 'OK' : cond.split(' ')[0]}
      </span>
    </button>
  );
}

export function OdontogramView() {
  const { activeOrgId, orgConfig, userAccount, patients, selectedPatientId, setSelectedPatientId } = useErp();
  const [dentition, setDentition] = useState<'permanent' | 'primary'>('permanent');
  const [teethMap, setTeethMap] = useState<Record<string, ToothState>>({});
  const [selectedTooth, setSelectedTooth] = useState<string>('16');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = userAccount?.role || 'receptionist';
  const canEditClinical = canPerformClinicalAction(role, 'edit');
  const activePatientId = selectedPatientId || patients[0]?.id || '';
  const activePatient = patients.find((p) => p.id === activePatientId) || null;

  useEffect(() => {
    if (!activePatientId) {
      setTeethMap({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    getDoc(doc(db, 'organizations', activeOrgId, 'odontograms', activePatientId))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          const rec = snap.data() as OdontogramRecord;
          setTeethMap(JSON.parse(rec.teethJson || '{}'));
        } else {
          setTeethMap({});
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load dental chart');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, activePatientId]);

  const currentToothState: ToothState = teethMap[selectedTooth] || {
    condition: 'Healthy',
    surfaces: [],
    notes: '',
  };

  const updateSelectedTooth = (patch: Partial<ToothState>) => {
    if (!canEditClinical) return;
    setSavedNotice(false);
    setTeethMap((prev) => ({
      ...prev,
      [selectedTooth]: {
        ...currentToothState,
        ...patch,
        updatedAt: new Date().toISOString(),
        updatedBy: userAccount?.email,
      },
    }));
  };

  const toggleSurface = (surface: ToothSurface) => {
    if (!canEditClinical) return;
    const exists = currentToothState.surfaces.includes(surface);
    const nextSurfaces = exists
      ? currentToothState.surfaces.filter((s) => s !== surface)
      : [...currentToothState.surfaces, surface];
    updateSelectedTooth({ surfaces: nextSurfaces });
  };

  const handleSaveChart = async () => {
    if (!userAccount || !activePatientId || !canEditClinical) return;
    setSaving(true);
    setError(null);
    try {
      await saveOdontogram(
        activeOrgId,
        {
          patientId: activePatientId,
          notation: 'FDI',
          teethJson: JSON.stringify(teethMap),
          updatedBy: userAccount.uid,
          updatedAt: new Date().toISOString(),
        },
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role }
      );
      setSavedNotice(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save odontogram.');
    } finally {
      setSaving(false);
    }
  };

  const quadrants = dentition === 'permanent' ? FDI_PERMANENT_QUADRANTS : FDI_PRIMARY_QUADRANTS;

  const chartedFindings = Object.entries(teethMap)
    .filter(([, st]) => st.condition !== 'Healthy' || (st.surfaces && st.surfaces.length > 0) || Boolean(st.notes))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6 print-a4-sheet">
      <PrintLetterhead
        clinicConfig={orgConfig}
        documentTitle={`Digital Odontogram Chart (${dentition === 'permanent' ? 'Permanent FDI' : 'Primary FDI'})`}
        patient={activePatient}
        preparedBy={userAccount?.displayName}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Interactive ISO 3950 Odontogram</h1>
          <p className="text-sm text-slate-500">
            FDI two-digit tooth notation · Surface mapping · Dentist-approved clinical charting
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={activePatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white min-w-[220px]"
          >
            {patients.length === 0 ? (
              <option value="">No patients registered</option>
            ) : (
              patients.map((p) => (
                <option key={p.id} value={p.id}>{p.fullName} ({p.patientCode})</option>
              ))
            )}
          </select>

          {activePatientId && (
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Chart (A4)</span>
            </button>
          )}

          {canEditClinical && activePatientId && (
            <button
              type="button"
              onClick={handleSaveChart}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving Chart...' : 'Approve & Save Chart'}</span>
            </button>
          )}
        </div>
      </div>

      {!canEditClinical && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2.5 text-xs text-amber-800 no-print">
          <Lock className="w-4 h-4 shrink-0" />
          <span>Read-only clinical view. Only an authorized Dentist or Clinic Owner may update odontogram findings.</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-700 no-print">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {savedNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-xs text-emerald-800 no-print">
          <Check className="w-4 h-4 shrink-0" />
          <span>Odontogram chart saved and logged to the clinical audit trail for {activePatient?.fullName}.</span>
        </div>
      )}

      {!activePatientId ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <Stethoscope className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-700">Register or select a patient to open their Digital Odontogram</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Interactive Teeth Chart */}
          <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-5 print-full-width print-a4-sheet">
            <div className="flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setDentition('permanent');
                    setSelectedTooth('16');
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    dentition === 'permanent' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Permanent (32 Teeth)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDentition('primary');
                    setSelectedTooth('55');
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    dentition === 'primary' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Primary (20 Teeth)
                </button>
              </div>

              {loading && <span className="text-xs text-slate-500">Loading chart...</span>}
            </div>

            {/* Upper Jaw */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-500 text-center">UPPER JAW (MAXILLARY) · R | L</p>
              <div className="grid grid-cols-2 gap-3 pb-3 border-b border-dashed border-slate-300">
                <div className="flex justify-end gap-1.5 flex-wrap">
                  {quadrants.upperRight.map((t) => (
                    <ToothSvg key={t} toothId={t} state={teethMap[t]} selected={selectedTooth === t} onClick={() => setSelectedTooth(t)} />
                  ))}
                </div>
                <div className="flex justify-start gap-1.5 flex-wrap">
                  {quadrants.upperLeft.map((t) => (
                    <ToothSvg key={t} toothId={t} state={teethMap[t]} selected={selectedTooth === t} onClick={() => setSelectedTooth(t)} />
                  ))}
                </div>
              </div>
            </div>

            {/* Lower Jaw */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="flex justify-end gap-1.5 flex-wrap">
                  {quadrants.lowerRight.map((t) => (
                    <ToothSvg key={t} toothId={t} state={teethMap[t]} selected={selectedTooth === t} onClick={() => setSelectedTooth(t)} />
                  ))}
                </div>
                <div className="flex justify-start gap-1.5 flex-wrap">
                  {quadrants.lowerLeft.map((t) => (
                    <ToothSvg key={t} toothId={t} state={teethMap[t]} selected={selectedTooth === t} onClick={() => setSelectedTooth(t)} />
                  ))}
                </div>
              </div>
              <p className="text-[11px] font-semibold text-slate-500 text-center">LOWER JAW (MANDIBULAR) · R | L</p>
            </div>

            {/* Condition Legend */}
            <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-3 text-[11px] text-slate-600">
              {CONDITIONS.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs border border-slate-300" style={{ backgroundColor: c.color }} />
                  <span>{c.name}</span>
                </div>
              ))}
            </div>

            {chartedFindings.length > 0 && (
              <div className="print-only pt-4 border-t border-slate-300">
                <h4 className="text-xs font-bold text-slate-900 mb-2">Recorded Dental Chart Findings</h4>
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-300 bg-slate-50">
                      <th className="py-1.5 px-2">FDI Tooth</th>
                      <th className="py-1.5 px-2">Condition</th>
                      <th className="py-1.5 px-2">Surfaces</th>
                      <th className="py-1.5 px-2">Clinical Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {chartedFindings.map(([toothId, st]) => (
                      <tr key={toothId}>
                        <td className="py-1.5 px-2 font-mono font-semibold">#{toothId}</td>
                        <td className="py-1.5 px-2">{st.condition}</td>
                        <td className="py-1.5 px-2 font-mono">{st.surfaces?.join(', ') || '—'}</td>
                        <td className="py-1.5 px-2">{st.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tooth Inspector */}
          <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
            <div className="border-b border-slate-200 pb-3">
              <p className="text-xs text-slate-500">Selected FDI Tooth</p>
              <h3 className="text-xl font-semibold text-slate-900 font-mono">Tooth #{selectedTooth}</h3>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">Clinical Condition</label>
              <div className="grid grid-cols-2 gap-1.5">
                {CONDITIONS.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    disabled={!canEditClinical}
                    onClick={() => updateSelectedTooth({ condition: c.name })}
                    className={`px-2.5 py-2 rounded-lg text-left text-xs font-medium border transition-colors cursor-pointer disabled:opacity-60 ${
                      currentToothState.condition === c.name
                        ? 'border-blue-600 bg-blue-50 text-blue-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">Affected Surfaces</label>
              <div className="flex flex-wrap gap-1.5">
                {SURFACES.map((s) => {
                  const active = currentToothState.surfaces.includes(s.code);
                  return (
                    <button
                      key={s.code}
                      type="button"
                      disabled={!canEditClinical}
                      onClick={() => toggleSurface(s.code)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer disabled:opacity-60 ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {s.code} · {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Dentist Clinical Note</label>
              <textarea
                rows={3}
                disabled={!canEditClinical}
                value={currentToothState.notes || ''}
                onChange={(e) => updateSelectedTooth({ notes: e.target.value })}
                placeholder="Clinical findings, pocket depth, restoration shade, or RCT working length..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg disabled:bg-slate-50"
              />
            </div>

            {currentToothState.updatedAt && (
              <p className="text-[11px] text-slate-400">
                Last updated {currentToothState.updatedAt.slice(0, 16).replace('T', ' ')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
