import React, { useMemo } from 'react';
import { Calendar, HeartPulse, ShieldAlert, User } from 'lucide-react';
import { Appointment, Patient, UserRole } from '../types/erp';
import { canPerformClinicalAction } from '../lib/rbac';

interface PatientSearchHoverCardProps {
  patient: Patient;
  appointments: Appointment[];
  role: UserRole;
  onSelect: () => void;
}

export function PatientSearchHoverCard({ patient, appointments, role, onSelect }: PatientSearchHoverCardProps) {
  const canViewClinical = canPerformClinicalAction(role, 'view');
  const today = new Date().toISOString().slice(0, 10);

  const nextAppointment = useMemo(() => {
    const activeStatuses = new Set(['Requested', 'Pending Confirmation', 'Confirmed', 'Checked In', 'Waiting', 'Seated', 'In Treatment']);
    return appointments
      .filter((a) => a.patientId === patient.id && a.date >= today && activeStatuses.has(a.status))
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))[0] || null;
  }, [appointments, patient.id, today]);

  return (
    <div
      role="dialog"
      aria-label={`Summary for ${patient.fullName}`}
      className="w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-4 text-xs text-slate-700 z-50 space-y-3"
    >
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-slate-900 truncate">{patient.fullName}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
            {patient.patientCode} · {patient.gender} · {patient.mobile}
          </p>
        </div>
        <User className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
      </div>

      {canViewClinical ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium text-slate-900">
            <HeartPulse className="w-3.5 h-3.5 text-teal-600" />
            <span>Basic Vitals &amp; Medical Summary</span>
          </div>
          <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-100 rounded-lg p-2 tabular-nums">
            <div>
              <p className="text-[10px] text-slate-500">Blood Pressure</p>
              <p className="font-medium text-slate-900">{patient.bloodPressure || 'Not recorded'}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500">Pulse</p>
              <p className="font-medium text-slate-900">{patient.pulseBpm ? `${patient.pulseBpm} bpm` : 'Not recorded'}</p>
            </div>
          </div>
          {(patient.allergies || patient.medicalAlerts) && (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-700" />
              <span className="line-clamp-2">
                {patient.medicalAlerts || `Allergies: ${patient.allergies}`}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-2">
          Consent: {patient.consentSigned ? 'Signed' : 'Pending'} · Clinical alerts restricted to clinical team
        </div>
      )}

      <div className="space-y-1 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-1.5 font-medium text-slate-900">
          <Calendar className="w-3.5 h-3.5 text-blue-600" />
          <span>Next Upcoming Appointment</span>
        </div>
        {nextAppointment ? (
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 space-y-0.5">
            <p className="font-medium text-slate-900 tabular-nums">
              {nextAppointment.date} · {nextAppointment.startTime} ({nextAppointment.status})
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {nextAppointment.serviceName || 'Dental Consultation'} · {nextAppointment.doctorName || 'Assigned Dentist'}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">No upcoming appointment scheduled</p>
        )}
      </div>

      <button
        type="button"
        onClick={onSelect}
        className="w-full py-1.5 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
      >
        Open Patient 360 Profile
      </button>
    </div>
  );
}
