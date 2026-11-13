import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ARCHIVE_MAGIC = Buffer.from('TDCE1'); // 5 bytes header for Tawakal Dental Encrypted Archive v1

export interface BackupManifest {
  backupId: string;
  orgId: string;
  backupType: string;
  createdAt: string;
  databaseSchemaVersion: string;
  applicationVersion: string;
  includedModules: string[];
  includedFileArchives: string[];
  recordCounts: Record<string, number>;
  totalRecords: number;
  fileCount: number;
  uncompressedBytes: number;
  compressedBytes: number;
  encryptionAlgorithm: 'aes-256-gcm';
  payloadSha256: string;
  verificationStatus: 'Verified';
}

export interface BackupSnapshotPayload {
  orgId: string;
  exportedAt: string;
  config: Record<string, unknown> | null;
  collections: Record<string, Record<string, unknown>[]>;
  documentRefs?: Record<string, unknown>[];
}

export interface StagingRestoreVerification {
  valid: boolean;
  backupId: string;
  orgId: string;
  schemaVersion: string;
  checksumMatched: boolean;
  decryptionVerified: boolean;
  recordCounts: Record<string, number>;
  totalRecords: number;
  fileCount: number;
  invoiceTotals: {
    invoiceCount: number;
    grandTotalPKR: number;
    paidAmountPKR: number;
    balanceDuePKR: number;
    invoicesReconciled: boolean;
  };
  journalTotals: {
    voucherCount: number;
    totalDebitPKR: number;
    totalCreditPKR: number;
    doubleEntryBalanced: boolean;
  };
  errors: string[];
  restoredPayload?: BackupSnapshotPayload;
  manifest?: BackupManifest;
}

export function normalizeAes256Key(keyMaterial: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(keyMaterial.trim())) {
    return Buffer.from(keyMaterial.trim(), 'hex');
  }
  return crypto.createHash('sha256').update(keyMaterial).digest();
}

export function computeSha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function encryptArchiveAes256Gcm(
  plaintext: Buffer,
  keyMaterial: string
): { envelopeBytes: Buffer; sha256: string; ivHex: string; authTagHex: string } {
  const key = normalizeAes256Key(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const envelopeBytes = Buffer.concat([ARCHIVE_MAGIC, iv, authTag, encrypted]);
  return {
    envelopeBytes,
    sha256: computeSha256(envelopeBytes),
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
  };
}

export function decryptArchiveAes256Gcm(envelopeBytes: Buffer, keyMaterial: string): Buffer {
  if (envelopeBytes.length < 5 + 12 + 16) {
    throw new Error('Encrypted archive is corrupted or truncated.');
  }
  const magic = envelopeBytes.subarray(0, 5);
  if (!magic.equals(ARCHIVE_MAGIC)) {
    throw new Error('Invalid archive header: expected TDCE1 encrypted envelope.');
  }
  const iv = envelopeBytes.subarray(5, 17);
  const authTag = envelopeBytes.subarray(17, 33);
  const ciphertext = envelopeBytes.subarray(33);
  const key = normalizeAes256Key(keyMaterial);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function buildEncryptedBackupArchive(params: {
  backupId: string;
  orgId: string;
  backupType: string;
  snapshot: BackupSnapshotPayload;
  encryptionKey: string;
}): {
  manifest: BackupManifest;
  envelopeBytes: Buffer;
  archiveChecksum: string;
  archiveFilename: string;
} {
  const { backupId, orgId, backupType, snapshot, encryptionKey } = params;
  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;

  for (const [col, rows] of Object.entries(snapshot.collections || {})) {
    const count = Array.isArray(rows) ? rows.length : 0;
    recordCounts[col] = count;
    totalRecords += count;
  }

  const docRefs = snapshot.documentRefs || snapshot.collections?.document_refs || [];
  const fileCount = Array.isArray(docRefs) ? docRefs.length : 0;
  const includedFileArchives = Array.isArray(docRefs)
    ? docRefs.map((d) => String(d.storagePath || d.filename || 'file_ref')).slice(0, 500)
    : [];

  const innerJson = JSON.stringify({
    schemaVersion: '1.0.0',
    appVersion: '1.1.0',
    backupId,
    orgId,
    exportedAt: snapshot.exportedAt,
    config: snapshot.config,
    collections: snapshot.collections,
    documentRefs: docRefs,
  });

  const uncompressedBuf = Buffer.from(innerJson, 'utf8');
  const compressedBuf = zlib.gzipSync(uncompressedBuf);
  const payloadSha256 = computeSha256(compressedBuf);

  const manifest: BackupManifest = {
    backupId,
    orgId,
    backupType,
    createdAt: new Date().toISOString(),
    databaseSchemaVersion: '1.0.0',
    applicationVersion: '1.1.0',
    includedModules: Object.keys(snapshot.collections || {}),
    includedFileArchives,
    recordCounts,
    totalRecords,
    fileCount,
    uncompressedBytes: uncompressedBuf.length,
    compressedBytes: compressedBuf.length,
    encryptionAlgorithm: 'aes-256-gcm',
    payloadSha256,
    verificationStatus: 'Verified',
  };

  // Never include encryption key inside archive
  const bundle = Buffer.from(
    JSON.stringify({
      manifest,
      payloadGzipBase64: compressedBuf.toString('base64'),
    }),
    'utf8'
  );

  const { envelopeBytes, sha256 } = encryptArchiveAes256Gcm(bundle, encryptionKey);
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  // Generic non-PII filename strictly based on date and backupId
  const archiveFilename = `bkp_${datePart}_${backupId.replace(/[^a-zA-Z0-9_-]/g, '')}.tawakal.enc`;

  return {
    manifest,
    envelopeBytes,
    archiveChecksum: sha256,
    archiveFilename,
  };
}

export function verifyAndStageRestore(params: {
  envelopeBytes: Buffer;
  expectedChecksum?: string;
  encryptionKey: string;
}): StagingRestoreVerification {
  const errors: string[] = [];
  const actualChecksum = computeSha256(params.envelopeBytes);
  const checksumMatched = params.expectedChecksum
    ? actualChecksum.toLowerCase() === params.expectedChecksum.toLowerCase()
    : true;

  if (!checksumMatched) {
    errors.push(`Archive SHA-256 checksum mismatch (expected ${params.expectedChecksum}, got ${actualChecksum}).`);
  }

  let decrypted: Buffer;
  try {
    decrypted = decryptArchiveAes256Gcm(params.envelopeBytes, params.encryptionKey);
  } catch (err) {
    return {
      valid: false,
      backupId: 'unknown',
      orgId: 'unknown',
      schemaVersion: 'unknown',
      checksumMatched,
      decryptionVerified: false,
      recordCounts: {},
      totalRecords: 0,
      fileCount: 0,
      invoiceTotals: {
        invoiceCount: 0,
        grandTotalPKR: 0,
        paidAmountPKR: 0,
        balanceDuePKR: 0,
        invoicesReconciled: false,
      },
      journalTotals: {
        voucherCount: 0,
        totalDebitPKR: 0,
        totalCreditPKR: 0,
        doubleEntryBalanced: false,
      },
      errors: [err instanceof Error ? err.message : 'AES-256-GCM decryption failed'],
    };
  }

  const parsedBundle = JSON.parse(decrypted.toString('utf8')) as {
    manifest: BackupManifest;
    payloadGzipBase64: string;
  };

  const compressedBuf = Buffer.from(parsedBundle.payloadGzipBase64, 'base64');
  const payloadHash = computeSha256(compressedBuf);
  if (payloadHash !== parsedBundle.manifest.payloadSha256) {
    errors.push('Inner payload SHA-256 mismatch.');
  }

  const innerJson = zlib.gunzipSync(compressedBuf).toString('utf8');
  const snapshot = JSON.parse(innerJson) as BackupSnapshotPayload & {
    schemaVersion: string;
    backupId: string;
  };

  if (snapshot.schemaVersion !== '1.0.0') {
    errors.push(`Unsupported database schema version: ${snapshot.schemaVersion}`);
  }

  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;
  for (const [k, rows] of Object.entries(snapshot.collections || {})) {
    const c = Array.isArray(rows) ? rows.length : 0;
    recordCounts[k] = c;
    totalRecords += c;
  }

  // Reconcile invoices in staging
  const invoices = snapshot.collections?.invoices || [];
  let grandTotalPKR = 0;
  let paidAmountPKR = 0;
  let balanceDuePKR = 0;
  let invoicesReconciled = true;
  for (const inv of invoices) {
    const gt = Number(inv.grandTotal || 0);
    const pd = Number(inv.paidAmount || 0);
    const bal = Number(inv.balanceDue || 0);
    grandTotalPKR += gt;
    paidAmountPKR += pd;
    balanceDuePKR += bal;
    if (Math.abs(gt - (pd + bal)) > 0.01) {
      invoicesReconciled = false;
      errors.push(`Invoice ${String(inv.invoiceNumber || inv.id)} failed balance check (grandTotal != paid + balanceDue).`);
    }
  }

  // Reconcile double-entry journals in staging
  const journals = snapshot.collections?.journals || [];
  let totalDebitPKR = 0;
  let totalCreditPKR = 0;
  let doubleEntryBalanced = true;
  for (const jrn of journals) {
    const d = Number(jrn.totalDebit || 0);
    const c = Number(jrn.totalCredit || 0);
    totalDebitPKR += d;
    totalCreditPKR += c;
    if (Math.abs(d - c) > 0.01) {
      doubleEntryBalanced = false;
      errors.push(`Journal ${String(jrn.entryNumber || jrn.id)} unbalanced (debit ${d} != credit ${c}).`);
    }
  }

  return {
    valid: errors.length === 0 && checksumMatched && invoicesReconciled && doubleEntryBalanced,
    backupId: parsedBundle.manifest.backupId,
    orgId: snapshot.orgId,
    schemaVersion: snapshot.schemaVersion,
    checksumMatched,
    decryptionVerified: true,
    recordCounts,
    totalRecords,
    fileCount: Array.isArray(snapshot.documentRefs) ? snapshot.documentRefs.length : 0,
    invoiceTotals: {
      invoiceCount: invoices.length,
      grandTotalPKR,
      paidAmountPKR,
      balanceDuePKR,
      invoicesReconciled,
    },
    journalTotals: {
      voucherCount: journals.length,
      totalDebitPKR,
      totalCreditPKR,
      doubleEntryBalanced,
    },
    errors,
    restoredPayload: snapshot,
    manifest: parsedBundle.manifest,
  };
}

export function signWordPressHmac(timestampSec: string, rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
}

export function sanitizePublicWordPressPayload(input: {
  clinicConfig: Record<string, unknown> | null;
  staff: Record<string, unknown>[];
  services: Record<string, unknown>[];
  includeApprovedPrices?: boolean;
}) {
  const cfg = input.clinicConfig || {};
  const publicDoctors = (input.staff || [])
    .filter((s) => s.role === 'dentist' && s.isActive === true)
    .map((s) => ({
      code: s.staffCode,
      fullName: s.fullName,
      specialty: s.specialty || 'Dental Surgeon',
      credentialStatus: s.credentialStatus || 'unverified',
      workingDays: s.workingDays || null,
      workingHours: s.workingHours || null,
      // Explicitly omit phone, baseSalary, compensationModel, pmdc private notes
    }));

  const publicServices = (input.services || [])
    .filter((srv) => srv.isActive === true)
    .map((srv) => ({
      code: srv.code,
      name: srv.name,
      category: srv.category,
      durationMin: srv.durationMin,
      ...(input.includeApprovedPrices ? { publicPricePKR: srv.standardPrice } : {}),
      // Explicitly omit internal labCost & materialCost
    }));

  return {
    clinicName: cfg.clinicName || 'Tawakal Dental Clinic',
    publicAddress: cfg.location || 'Saudabad, Malir, Karachi, Pakistan',
    publicPhone: cfg.phone || '',
    openingHours: cfg.openingHours || '',
    timezone: cfg.timezone || 'Asia/Karachi',
    doctors: publicDoctors,
    services: publicServices,
    publishedAt: new Date().toISOString(),
  };
}
