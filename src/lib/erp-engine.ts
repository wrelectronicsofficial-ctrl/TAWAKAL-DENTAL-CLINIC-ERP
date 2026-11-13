import { Appointment, InvoiceLineItem, JournalLine, PaymentAllocation } from '../types/erp';

export function formatPKR(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `PKR ${safe.toLocaleString('en-PK')}`;
}

export function timeToMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) {
    throw new Error(`Invalid time format: ${hhmm}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Time out of bounds: ${hhmm}`);
  }
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function checkAppointmentConflict(
  existingAppointments: Appointment[],
  candidate: {
    id?: string;
    doctorId: string;
    chairNumber?: string;
    date: string;
    startTime: string;
    endTime: string;
  }
): { conflict: boolean; reason?: string } {
  const newStart = timeToMinutes(candidate.startTime);
  const newEnd = timeToMinutes(candidate.endTime);

  if (newEnd <= newStart) {
    return { conflict: true, reason: 'End time must be strictly after start time.' };
  }

  const inactiveStatuses = new Set(['Cancelled', 'Rescheduled', 'No Show']);

  for (const existing of existingAppointments) {
    if (candidate.id && existing.id === candidate.id) continue;
    if (existing.date !== candidate.date) continue;
    if (inactiveStatuses.has(existing.status)) continue;

    const exStart = timeToMinutes(existing.startTime);
    const exEnd = timeToMinutes(existing.endTime);
    const overlaps = newStart < exEnd && newEnd > exStart;

    if (!overlaps) continue;

    if (existing.doctorId === candidate.doctorId) {
      return {
        conflict: true,
        reason: `Doctor conflict: ${existing.doctorName || existing.doctorId} already has ${existing.appointmentCode} (${existing.startTime}–${existing.endTime}).`,
      };
    }

    if (candidate.chairNumber && existing.chairNumber && existing.chairNumber === candidate.chairNumber) {
      return {
        conflict: true,
        reason: `Operatory conflict: ${candidate.chairNumber} is already booked (${existing.startTime}–${existing.endTime}).`,
      };
    }
  }

  return { conflict: false };
}

export function computeAvailableSlots(
  openTime: string,
  closeTime: string,
  slotMinutes: number,
  existingAppointments: Appointment[],
  doctorId: string,
  chairNumber: string | undefined,
  date: string
): string[] {
  const startMin = timeToMinutes(openTime);
  const endMin = timeToMinutes(closeTime);
  const slots: string[] = [];

  for (let t = startMin; t + slotMinutes <= endMin; t += slotMinutes) {
    const s = minutesToTime(t);
    const e = minutesToTime(t + slotMinutes);
    const check = checkAppointmentConflict(existingAppointments, {
      doctorId,
      chairNumber,
      date,
      startTime: s,
      endTime: e,
    });
    if (!check.conflict) {
      slots.push(s);
    }
  }

  return slots;
}

export function calculateInvoiceTotals(
  items: InvoiceLineItem[],
  discount: number,
  taxRatePct: number,
  payments: PaymentAllocation[]
): {
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  paidAmount: number;
  balanceDue: number;
  status: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Refunded';
} {
  const subtotal = Math.round(items.reduce((sum, item) => sum + Math.max(0, item.qty) * Math.max(0, item.unitPrice), 0));
  const safeDiscount = Math.min(subtotal, Math.max(0, Math.round(discount)));
  const taxable = Math.max(0, subtotal - safeDiscount);
  const tax = Math.round((taxable * Math.max(0, taxRatePct)) / 100);
  const grandTotal = taxable + tax;
  const paidAmount = Math.round(payments.reduce((sum, p) => sum + Math.max(0, p.amount), 0));
  const balanceDue = Math.max(0, grandTotal - paidAmount);

  let status: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Refunded' = 'Unpaid';
  if (grandTotal > 0 && paidAmount >= grandTotal) {
    status = 'Paid';
  } else if (paidAmount > 0) {
    status = 'Partially Paid';
  }

  return { subtotal, discount: safeDiscount, tax, grandTotal, paidAmount, balanceDue, status };
}

export function validateDoubleEntryJournal(lines: JournalLine[]): {
  valid: boolean;
  totalDebit: number;
  totalCredit: number;
  error?: string;
} {
  if (!lines.length || lines.length < 2) {
    return { valid: false, totalDebit: 0, totalCredit: 0, error: 'A double-entry journal requires at least 2 lines.' };
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    if (line.debit < 0 || line.credit < 0) {
      return { valid: false, totalDebit: 0, totalCredit: 0, error: 'Debit and credit amounts cannot be negative.' };
    }
    if (line.debit > 0 && line.credit > 0) {
      return { valid: false, totalDebit: 0, totalCredit: 0, error: 'A single journal line cannot carry both debit and credit.' };
    }
    totalDebit += Math.round(line.debit);
    totalCredit += Math.round(line.credit);
  }
  if (totalDebit <= 0) {
    return { valid: false, totalDebit, totalCredit, error: 'Total debit must be greater than zero.' };
  }
  if (totalDebit !== totalCredit) {
    return {
      valid: false,
      totalDebit,
      totalCredit,
      error: `Unbalanced voucher: Total Debit (${totalDebit}) must equal Total Credit (${totalCredit}).`,
    };
  }
  return { valid: true, totalDebit, totalCredit };
}

export function applyInventoryMovement(currentStock: number, delta: number): number {
  const next = Math.round((currentStock + delta) * 100) / 100;
  if (next < 0) {
    throw new Error(`Insufficient stock: current ${currentStock}, requested delta ${delta}.`);
  }
  return next;
}

const EMERGENCY_PATTERNS = [
  /uncontrollable\s+bleeding/i,
  /heavy\s+bleeding/i,
  /khoon\s+(nahi|band|ziyada)/i,
  /severe\s+swelling/i,
  /soojan/i,
  /sujan/i,
  /breathing\s+difficulty/i,
  /saans/i,
  /swallowing\s+difficulty/i,
  /nigalne/i,
  /trauma/i,
  /accident/i,
  /jaw\s+(broken|fracture)/i,
  /knocked\s+out\s+tooth/i,
  /unbearable\s+pain/i,
];

export function detectEmergencyTriage(message: string): boolean {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(message));
}

export const FDI_PERMANENT_QUADRANTS = {
  upperRight: ['18', '17', '16', '15', '14', '13', '12', '11'],
  upperLeft: ['21', '22', '23', '24', '25', '26', '27', '28'],
  lowerLeft: ['31', '32', '33', '34', '35', '36', '37', '38'],
  lowerRight: ['48', '47', '46', '45', '44', '43', '42', '41'],
};

export const FDI_PRIMARY_QUADRANTS = {
  upperRight: ['55', '54', '53', '52', '51'],
  upperLeft: ['61', '62', '63', '64', '65'],
  lowerLeft: ['71', '72', '73', '74', '75'],
  lowerRight: ['85', '84', '83', '82', '81'],
};
