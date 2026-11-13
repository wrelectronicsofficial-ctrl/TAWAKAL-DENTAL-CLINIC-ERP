import ExcelJS from 'exceljs';
import { canPerformClinicalAction, canPerformFinancialAction } from './rbac';
import { UserRole } from '../types/erp';

export type ExcelExportDomain =
  | 'patients_clinical'
  | 'appointments_ops'
  | 'financial_ledger'
  | 'management_ai';

export interface ExcelExportSnapshot {
  clinicName: string;
  environment: 'PRODUCTION' | 'DEMO';
  patients: Record<string, unknown>[];
  appointments: Record<string, unknown>[];
  staff: Record<string, unknown>[];
  services: Record<string, unknown>[];
  treatmentPlans: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  journals: Record<string, unknown>[];
  budgets: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
  sterilizationLogs: Record<string, unknown>[];
  callRecords: Record<string, unknown>[];
  documentRefs?: Record<string, unknown>[];
}

export interface ExcelImportValidationRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  valid: boolean;
  errors: string[];
  mapped?: Record<string, unknown>;
}

export interface ExcelImportPreview {
  worksheetName: string;
  targetEntity: 'patients' | 'staff' | 'inventory' | 'services';
  columnsDetected: string[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: ExcelImportValidationRow[];
}

function styleSheetHeader(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 24;
  if (sheet.columnCount > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };
  }
}

function formatPkrColumns(sheet: ExcelJS.Worksheet, columnKeys: string[]) {
  for (const key of columnKeys) {
    const colIdx = (sheet.columns || []).findIndex((c) => c.key === key);
    if (colIdx >= 0) {
      sheet.getColumn(colIdx + 1).numFmt = '"PKR "#,##0';
    }
  }
}

export function assertExcelExportAuthorized(role: UserRole, domain: ExcelExportDomain): void {
  if (domain === 'patients_clinical' && !canPerformClinicalAction(role, 'export')) {
    throw new Error(`Unauthorized Excel export: role '${role}' lacks clinical export permission.`);
  }
  if (domain === 'financial_ledger' && !canPerformFinancialAction(role, 'export')) {
    throw new Error(`Unauthorized Excel export: role '${role}' lacks financial export permission.`);
  }
  if (domain === 'management_ai' && !['owner', 'admin', 'manager'].includes(role)) {
    throw new Error(`Unauthorized Excel export: role '${role}' lacks management export permission.`);
  }
  if (domain === 'appointments_ops' && !['owner', 'admin', 'manager', 'dentist', 'inventory_manager'].includes(role)) {
    throw new Error(`Unauthorized Excel export: role '${role}' lacks operations export permission.`);
  }
}

export async function buildDomainExcelWorkbook(
  domain: ExcelExportDomain,
  snapshot: ExcelExportSnapshot,
  actor: { email: string; role: UserRole }
): Promise<{ buffer: Buffer; filename: string; sheetSummary: Record<string, number> }> {
  assertExcelExportAuthorized(actor.role, domain);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tawakal Dental Clinic ERP';
  wb.created = new Date();
  const sheetSummary: Record<string, number> = {};

  const summarySheet = wb.addWorksheet('Export Summary');
  summarySheet.columns = [
    { header: 'Parameter', key: 'param', width: 32 },
    { header: 'Value', key: 'val', width: 48 },
  ];
  summarySheet.addRows([
    { param: 'Clinic Name', val: snapshot.clinicName },
    { param: 'Environment', val: snapshot.environment },
    { param: 'Export Domain', val: domain },
    { param: 'Exported By', val: `${actor.email} (${actor.role})` },
    { param: 'Export Timestamp (UTC)', val: new Date().toISOString() },
    { param: 'Currency', val: 'PKR' },
    { param: 'Imaging Security Policy', val: 'References only (no raw binary images embedded)' },
  ]);
  styleSheetHeader(summarySheet);

  if (domain === 'patients_clinical') {
    const pSheet = wb.addWorksheet('Patients Master');
    pSheet.columns = [
      { header: 'Patient ID', key: 'id', width: 22 },
      { header: 'Patient Code', key: 'patientCode', width: 15 },
      { header: 'Full Name', key: 'fullName', width: 26 },
      { header: 'Gender', key: 'gender', width: 12 },
      { header: 'Mobile', key: 'mobile', width: 18 },
      { header: 'Allergies', key: 'allergies', width: 24 },
      { header: 'Medical Conditions', key: 'medicalConditions', width: 26 },
      { header: 'Blood Pressure', key: 'bloodPressure', width: 15 },
      { header: 'Consent Signed', key: 'consentSigned', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Created Date', key: 'createdAt', width: 22 },
    ];
    snapshot.patients.forEach((p) => pSheet.addRow(p));
    styleSheetHeader(pSheet);
    sheetSummary['Patients Master'] = snapshot.patients.length;

    const tpSheet = wb.addWorksheet('Treatment Plans');
    tpSheet.columns = [
      { header: 'Plan ID', key: 'id', width: 22 },
      { header: 'Plan Code', key: 'planCode', width: 14 },
      { header: 'Patient ID', key: 'patientId', width: 22 },
      { header: 'Patient Name', key: 'patientName', width: 24 },
      { header: 'Doctor Name', key: 'doctorName', width: 24 },
      { header: 'Title', key: 'title', width: 32 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Total Estimated (PKR)', key: 'totalEstimated', width: 20 },
      { header: 'Net Estimated (PKR)', key: 'netEstimated', width: 20 },
      { header: 'Created Date', key: 'createdAt', width: 22 },
    ];
    snapshot.treatmentPlans.forEach((tp) => tpSheet.addRow(tp));
    styleSheetHeader(tpSheet);
    formatPkrColumns(tpSheet, ['totalEstimated', 'netEstimated']);
    sheetSummary['Treatment Plans'] = snapshot.treatmentPlans.length;

    const imgSheet = wb.addWorksheet('Imaging File References');
    imgSheet.columns = [
      { header: 'File ID', key: 'id', width: 22 },
      { header: 'Patient ID', key: 'patientId', width: 22 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Filename', key: 'filename', width: 28 },
      { header: 'SHA-256 Checksum', key: 'checksum', width: 34 },
      { header: 'Authorized Path', key: 'storagePath', width: 36 },
      { header: 'Created Date', key: 'createdAt', width: 22 },
    ];
    (snapshot.documentRefs || []).forEach((d) => imgSheet.addRow(d));
    styleSheetHeader(imgSheet);
    sheetSummary['Imaging File References'] = (snapshot.documentRefs || []).length;
  }

  if (domain === 'appointments_ops') {
    const aptSheet = wb.addWorksheet('Appointments');
    aptSheet.columns = [
      { header: 'Appointment ID', key: 'id', width: 22 },
      { header: 'Code', key: 'appointmentCode', width: 14 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Start', key: 'startTime', width: 10 },
      { header: 'End', key: 'endTime', width: 10 },
      { header: 'Patient ID', key: 'patientId', width: 20 },
      { header: 'Patient Name', key: 'patientName', width: 24 },
      { header: 'Doctor Name', key: 'doctorName', width: 24 },
      { header: 'Service', key: 'serviceName', width: 26 },
      { header: 'Chair', key: 'chairNumber', width: 12 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Queue Token', key: 'queueToken', width: 14 },
    ];
    snapshot.appointments.forEach((a) => aptSheet.addRow(a));
    styleSheetHeader(aptSheet);
    sheetSummary['Appointments'] = snapshot.appointments.length;

    const stfSheet = wb.addWorksheet('Doctors & Staff');
    stfSheet.columns = [
      { header: 'Staff ID', key: 'id', width: 20 },
      { header: 'Code', key: 'staffCode', width: 12 },
      { header: 'Full Name', key: 'fullName', width: 26 },
      { header: 'Role', key: 'role', width: 16 },
      { header: 'Specialty', key: 'specialty', width: 26 },
      { header: 'PMDC Number', key: 'pmdcNumber', width: 18 },
      { header: 'Credential Status', key: 'credentialStatus', width: 16 },
      { header: 'Consultation Fee', key: 'consultationFee', width: 18 },
      { header: 'Assigned Chair', key: 'assignedChair', width: 14 },
      { header: 'Active', key: 'isActive', width: 10 },
    ];
    snapshot.staff.forEach((s) => stfSheet.addRow(s));
    styleSheetHeader(stfSheet);
    formatPkrColumns(stfSheet, ['consultationFee']);
    sheetSummary['Doctors & Staff'] = snapshot.staff.length;

    const srvSheet = wb.addWorksheet('Dental Procedures');
    srvSheet.columns = [
      { header: 'Service ID', key: 'id', width: 20 },
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Procedure Name', key: 'name', width: 28 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Standard Price', key: 'standardPrice', width: 18 },
      { header: 'Duration (min)', key: 'durationMin', width: 15 },
      { header: 'Active', key: 'isActive', width: 10 },
    ];
    snapshot.services.forEach((s) => srvSheet.addRow(s));
    styleSheetHeader(srvSheet);
    formatPkrColumns(srvSheet, ['standardPrice']);
    sheetSummary['Dental Procedures'] = snapshot.services.length;

    const invSheet = wb.addWorksheet('Inventory');
    invSheet.columns = [
      { header: 'Item ID', key: 'id', width: 20 },
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Item Name', key: 'name', width: 28 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Current Stock', key: 'currentStock', width: 14 },
      { header: 'Min Stock', key: 'minStock', width: 12 },
      { header: 'Purchase Cost', key: 'purchaseCost', width: 16 },
      { header: 'Batch', key: 'batchNumber', width: 14 },
      { header: 'Expiry Date', key: 'expiryDate', width: 14 },
      { header: 'Supplier', key: 'supplierName', width: 24 },
    ];
    snapshot.inventory.forEach((i) => invSheet.addRow(i));
    styleSheetHeader(invSheet);
    formatPkrColumns(invSheet, ['purchaseCost']);
    sheetSummary['Inventory'] = snapshot.inventory.length;

    const strSheet = wb.addWorksheet('Sterilization Logs');
    strSheet.columns = [
      { header: 'Log ID', key: 'id', width: 20 },
      { header: 'Batch ID', key: 'batchId', width: 18 },
      { header: 'Instrument Set', key: 'instrumentSet', width: 28 },
      { header: 'Equipment', key: 'equipmentName', width: 22 },
      { header: 'Cycle Date', key: 'cycleDate', width: 14 },
      { header: 'Result', key: 'indicatorResult', width: 12 },
      { header: 'Staff', key: 'responsibleStaff', width: 22 },
    ];
    snapshot.sterilizationLogs.forEach((l) => strSheet.addRow(l));
    styleSheetHeader(strSheet);
    sheetSummary['Sterilization Logs'] = snapshot.sterilizationLogs.length;
  }

  if (domain === 'financial_ledger') {
    const invSheet = wb.addWorksheet('Invoices');
    invSheet.columns = [
      { header: 'Invoice ID', key: 'id', width: 22 },
      { header: 'Invoice Number', key: 'invoiceNumber', width: 18 },
      { header: 'Patient ID', key: 'patientId', width: 20 },
      { header: 'Patient Name', key: 'patientName', width: 24 },
      { header: 'Grand Total', key: 'grandTotal', width: 16 },
      { header: 'Paid Amount', key: 'paidAmount', width: 16 },
      { header: 'Balance Due', key: 'balanceDue', width: 16 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Created Date', key: 'createdAt', width: 22 },
    ];
    snapshot.invoices.forEach((inv) => invSheet.addRow(inv));
    styleSheetHeader(invSheet);
    formatPkrColumns(invSheet, ['grandTotal', 'paidAmount', 'balanceDue']);
    sheetSummary['Invoices'] = snapshot.invoices.length;

    const outSheet = wb.addWorksheet('Outstanding Balances');
    outSheet.columns = [
      { header: 'Invoice ID', key: 'id', width: 22 },
      { header: 'Invoice Number', key: 'invoiceNumber', width: 18 },
      { header: 'Patient ID', key: 'patientId', width: 20 },
      { header: 'Patient Name', key: 'patientName', width: 24 },
      { header: 'Grand Total', key: 'grandTotal', width: 16 },
      { header: 'Paid Amount', key: 'paidAmount', width: 16 },
      { header: 'Balance Due', key: 'balanceDue', width: 16 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Created Date', key: 'createdAt', width: 22 },
    ];
    const unpaidRows = snapshot.invoices.filter((i) => Number(i.balanceDue || 0) > 0);
    unpaidRows.forEach((inv) => outSheet.addRow(inv));
    styleSheetHeader(outSheet);
    formatPkrColumns(outSheet, ['grandTotal', 'paidAmount', 'balanceDue']);
    sheetSummary['Outstanding Balances'] = unpaidRows.length;

    const jSheet = wb.addWorksheet('Accounting Journals');
    jSheet.columns = [
      { header: 'Journal ID', key: 'id', width: 22 },
      { header: 'Voucher No', key: 'entryNumber', width: 16 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Type', key: 'voucherType', width: 12 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Description', key: 'description', width: 34 },
      { header: 'Total Debit', key: 'totalDebit', width: 16 },
      { header: 'Total Credit', key: 'totalCredit', width: 16 },
      { header: 'Reference ID', key: 'referenceId', width: 18 },
    ];
    snapshot.journals.forEach((j) => jSheet.addRow(j));
    styleSheetHeader(jSheet);
    formatPkrColumns(jSheet, ['totalDebit', 'totalCredit']);
    sheetSummary['Accounting Journals'] = snapshot.journals.length;

    const bSheet = wb.addWorksheet('Monthly Budgets');
    bSheet.columns = [
      { header: 'Budget ID', key: 'id', width: 20 },
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Category', key: 'category', width: 22 },
      { header: 'Planned Amount', key: 'plannedAmount', width: 18 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];
    snapshot.budgets.forEach((b) => bSheet.addRow(b));
    styleSheetHeader(bSheet);
    formatPkrColumns(bSheet, ['plannedAmount']);
    sheetSummary['Monthly Budgets'] = snapshot.budgets.length;
  }

  if (domain === 'management_ai') {
    const callSheet = wb.addWorksheet('AI Call Reports');
    callSheet.columns = [
      { header: 'Call ID', key: 'id', width: 20 },
      { header: 'Call Code', key: 'callCode', width: 14 },
      { header: 'Direction', key: 'direction', width: 12 },
      { header: 'Caller Number', key: 'callerNumber', width: 18 },
      { header: 'Language', key: 'language', width: 16 },
      { header: 'Intent', key: 'intent', width: 20 },
      { header: 'Outcome', key: 'outcome', width: 26 },
      { header: 'Emergency', key: 'emergencyFlag', width: 12 },
      { header: 'Consent', key: 'consentDisclosed', width: 12 },
      { header: 'Created Date', key: 'createdAt', width: 22 },
    ];
    snapshot.callRecords.forEach((c) => callSheet.addRow(c));
    styleSheetHeader(callSheet);
    sheetSummary['AI Call Reports'] = snapshot.callRecords.length;

    const mgmtSheet = wb.addWorksheet('Management Totals');
    mgmtSheet.columns = [
      { header: 'Metric', key: 'metric', width: 34 },
      { header: 'Value', key: 'value', width: 20 },
    ];
    const totalBilled = snapshot.invoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const totalCollected = snapshot.invoices.reduce((s, i) => s + Number(i.paidAmount || 0), 0);
    const totalDue = snapshot.invoices.reduce((s, i) => s + Number(i.balanceDue || 0), 0);
    mgmtSheet.addRows([
      { metric: 'Total Patients', value: snapshot.patients.length },
      { metric: 'Total Appointments', value: snapshot.appointments.length },
      { metric: 'Total Billed (PKR)', value: totalBilled },
      { metric: 'Total Collected (PKR)', value: totalCollected },
      { metric: 'Outstanding Receivables (PKR)', value: totalDue },
      { metric: 'AI Calls Logged', value: snapshot.callRecords.length },
    ]);
    styleSheetHeader(mgmtSheet);
    sheetSummary['Management Totals'] = 6;
  }

  for (const [sheetName, count] of Object.entries(sheetSummary)) {
    summarySheet.addRow({ param: `Sheet Row Count · ${sheetName}`, val: count });
  }

  const rawArrayBuffer = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(rawArrayBuffer);
  const datePart = new Date().toISOString().slice(0, 10);
  const filename = `Tawakal_Dental_${domain}_${snapshot.environment}_${datePart}.xlsx`;

  return { buffer, filename, sheetSummary };
}

export async function parseAndValidateExcelImport(params: {
  buffer: Buffer;
  targetEntity: 'patients' | 'staff' | 'inventory' | 'services';
  existingCodes: string[];
}): Promise<ExcelImportPreview> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(params.buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error('Uploaded Excel file contains no worksheets.');
  }

  const headerRow = ws.getRow(1);
  const columnsDetected: string[] = [];
  headerRow.eachCell((cell, colNum) => {
    columnsDetected[colNum - 1] = String(cell.value || '').trim();
  });

  const existingSet = new Set(params.existingCodes.map((c) => c.trim().toLowerCase()));
  const seenInFile = new Set<string>();
  const rows: ExcelImportValidationRow[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw: Record<string, unknown> = {};
    let hasValue = false;
    columnsDetected.forEach((colName, idx) => {
      if (!colName) return;
      const val = row.getCell(idx + 1).value;
      const normalized = val && typeof val === 'object' && 'text' in val ? String((val as { text: string }).text) : val;
      if (normalized !== null && normalized !== undefined && String(normalized).trim() !== '') {
        hasValue = true;
      }
      raw[colName] = normalized ?? '';
    });
    if (!hasValue) return;

    const errs: string[] = [];
    let mapped: Record<string, unknown> | undefined;

    if (params.targetEntity === 'patients') {
      const fullName = String(raw.fullName || raw['Full Name'] || '').trim();
      const mobile = String(raw.mobile || raw['Mobile'] || '').trim();
      const genderRaw = String(raw.gender || raw['Gender'] || 'Other').trim();
      const gender = ['Male', 'Female', 'Other'].includes(genderRaw) ? genderRaw : 'Other';
      const patientCode = String(raw.patientCode || raw['Patient Code'] || '').trim();

      if (!fullName) errs.push('Missing Full Name');
      if (!mobile || mobile.length < 4) errs.push('Missing or invalid Mobile');
      if (patientCode) {
        const key = patientCode.toLowerCase();
        if (existingSet.has(key) || seenInFile.has(key)) errs.push(`Duplicate Patient Code: ${patientCode}`);
        seenInFile.add(key);
      }

      if (errs.length === 0) {
        mapped = {
          patientCode: patientCode || `IMP-${rowNumber}`,
          fullName,
          gender,
          mobile,
          city: String(raw.city || raw['City'] || 'Karachi').trim(),
          status: 'active',
        };
      }
    } else if (params.targetEntity === 'inventory') {
      const sku = String(raw.sku || raw['SKU'] || '').trim();
      const name = String(raw.name || raw['Item Name'] || '').trim();
      const currentStock = Number(raw.currentStock ?? raw['Current Stock'] ?? 0);
      const minStock = Number(raw.minStock ?? raw['Min Stock'] ?? 5);

      if (!sku) errs.push('Missing SKU');
      if (!name) errs.push('Missing Item Name');
      if (Number.isNaN(currentStock) || currentStock < 0) errs.push('Current Stock must be >= 0');
      if (sku) {
        const key = sku.toLowerCase();
        if (existingSet.has(key) || seenInFile.has(key)) errs.push(`Duplicate SKU: ${sku}`);
        seenInFile.add(key);
      }

      if (errs.length === 0) {
        mapped = {
          sku,
          name,
          category: String(raw.category || raw['Category'] || 'Consumables').trim(),
          unit: String(raw.unit || raw['Unit'] || 'Box').trim(),
          currentStock,
          minStock: Number.isNaN(minStock) ? 5 : minStock,
          supplierName: String(raw.supplierName || raw['Supplier'] || '').trim() || undefined,
        };
      }
    } else if (params.targetEntity === 'services') {
      const code = String(raw.code || raw['Code'] || '').trim();
      const name = String(raw.name || raw['Procedure Name'] || '').trim();
      const standardPrice = Number(raw.standardPrice ?? raw['Standard Price'] ?? -1);
      const durationMin = Number(raw.durationMin ?? raw['Duration (min)'] ?? 30);

      if (!code) errs.push('Missing Service Code');
      if (!name) errs.push('Missing Procedure Name');
      if (Number.isNaN(standardPrice) || standardPrice < 0) errs.push('Standard Price (PKR) must be >= 0');
      if (code) {
        const key = code.toLowerCase();
        if (existingSet.has(key) || seenInFile.has(key)) errs.push(`Duplicate Service Code: ${code}`);
        seenInFile.add(key);
      }

      if (errs.length === 0) {
        mapped = {
          code,
          name,
          category: String(raw.category || raw['Category'] || 'General').trim(),
          standardPrice: Math.round(standardPrice),
          durationMin: Math.max(10, Math.round(durationMin || 30)),
          isActive: true,
        };
      }
    } else if (params.targetEntity === 'staff') {
      const staffCode = String(raw.staffCode || raw['Code'] || '').trim();
      const fullName = String(raw.fullName || raw['Full Name'] || '').trim();
      const role = String(raw.role || raw['Role'] || 'assistant').trim();

      if (!fullName) errs.push('Missing Full Name');
      if (staffCode) {
        const key = staffCode.toLowerCase();
        if (existingSet.has(key) || seenInFile.has(key)) errs.push(`Duplicate Staff Code: ${staffCode}`);
        seenInFile.add(key);
      }

      if (errs.length === 0) {
        mapped = {
          staffCode: staffCode || `STF-${rowNumber}`,
          fullName,
          role,
          specialty: String(raw.specialty || raw['Specialty'] || '').trim() || undefined,
          isActive: true,
        };
      }
    }

    rows.push({
      rowNumber,
      raw,
      valid: errs.length === 0,
      errors: errs,
      mapped,
    });
  });

  const validRows = rows.filter((r) => r.valid).length;
  return {
    worksheetName: ws.name,
    targetEntity: params.targetEntity,
    columnsDetected: columnsDetected.filter(Boolean),
    totalRows: rows.length,
    validRows,
    errorRows: rows.length - validRows,
    rows,
  };
}
