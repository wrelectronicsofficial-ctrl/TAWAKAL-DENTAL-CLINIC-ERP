import React from 'react';
import { OrganizationConfig, Patient } from '../types/erp';

interface PrintLetterheadProps {
  clinicConfig: OrganizationConfig | null;
  documentTitle: string;
  subtitle?: string;
  patient?: Patient | null;
  preparedBy?: string;
  metadataPairs?: { label: string; value: string }[];
}

export function PrintLetterhead({
  clinicConfig,
  documentTitle,
  subtitle,
  patient,
  preparedBy,
  metadataPairs = [],
}: PrintLetterheadProps) {
  const printedAt = new Date().toLocaleString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="print-only mb-5 pb-4 border-b-2 border-slate-900 text-slate-900">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            {clinicConfig?.clinicName || 'Tawakal Dental Clinic'}
          </h1>
          <p className="text-xs text-slate-600">
            {clinicConfig?.location || 'Saudabad, Malir, Karachi, Pakistan'}
            {clinicConfig?.phone ? ` · Tel: ${clinicConfig.phone}` : ''}
          </p>
          {clinicConfig?.shccRegistrationNo && (
            <p className="text-[11px] font-mono text-slate-600">
              SHCC Reg: {clinicConfig.shccRegistrationNo}
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="text-sm font-bold text-slate-900">{documentTitle}</p>
          {subtitle && <p className="text-xs text-slate-600">{subtitle}</p>}
          <p className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
            Printed: {printedAt}
            {preparedBy ? ` · By: ${preparedBy}` : ''}
          </p>
        </div>
      </div>

      {(patient || metadataPairs.length > 0) && (
        <div className="mt-3 pt-2.5 border-t border-slate-300 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
          {patient && (
            <>
              <div>
                <span className="text-slate-500">Patient:</span>{' '}
                <span className="font-semibold text-slate-900">{patient.fullName}</span>
              </div>
              <div>
                <span className="text-slate-500">Patient ID:</span>{' '}
                <span className="font-mono font-medium text-slate-900">{patient.patientCode}</span>
              </div>
              <div>
                <span className="text-slate-500">Gender / Mobile:</span>{' '}
                <span className="text-slate-900">{patient.gender} · {patient.mobile}</span>
              </div>
              {patient.allergies && (
                <div>
                  <span className="text-red-700 font-semibold">Allergies:</span>{' '}
                  <span className="text-red-800 font-medium">{patient.allergies}</span>
                </div>
              )}
            </>
          )}
          {metadataPairs.map((pair) => (
            <div key={pair.label}>
              <span className="text-slate-500">{pair.label}:</span>{' '}
              <span className="font-medium text-slate-900 tabular-nums">{pair.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
