import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { DecodedIdToken } from 'firebase-admin/auth';
import { Storage } from '@google-cloud/storage';
import { adminAuth, resolveVerifiedRole } from './src/lib/firebase-admin.ts';
import { detectEmergencyTriage } from './src/lib/erp-engine.ts';
import {
  buildEncryptedBackupArchive,
  computeSha256,
  sanitizePublicWordPressPayload,
  signWordPressHmac,
  verifyAndStageRestore,
} from './src/lib/backup-engine.ts';
import {
  assertExcelExportAuthorized,
  buildDomainExcelWorkbook,
  ExcelExportDomain,
  parseAndValidateExcelImport,
} from './src/lib/excel-engine.ts';
import { UserRole } from './src/types/erp.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Private non-public backup archive vault (never mounted via express.static)
const PRIVATE_VAULT_ROOT = path.join(__dirname, '.clinic_vault');
const MASTER_KEY_FILE = path.join(PRIVATE_VAULT_ROOT, '.vault_master.key');

function ensureVaultDir(orgId?: string): string {
  if (!fs.existsSync(PRIVATE_VAULT_ROOT)) {
    fs.mkdirSync(PRIVATE_VAULT_ROOT, { recursive: true, mode: 0o700 });
  }
  if (!orgId) return PRIVATE_VAULT_ROOT;
  const safeOrg = orgId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(PRIVATE_VAULT_ROOT, safeOrg);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

function getBackupEncryptionKey(): { key: string; source: 'env_kms' | 'vault_file' } {
  if (process.env.BACKUP_ENCRYPTION_KEY && process.env.BACKUP_ENCRYPTION_KEY.trim().length >= 32) {
    return { key: process.env.BACKUP_ENCRYPTION_KEY.trim(), source: 'env_kms' };
  }
  ensureVaultDir();
  if (fs.existsSync(MASTER_KEY_FILE)) {
    return { key: fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim(), source: 'vault_file' };
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(MASTER_KEY_FILE, generated, { mode: 0o600 });
  return { key: generated, source: 'vault_file' };
}

// Server-side OAuth token store (never exposed to browser JavaScript)
const msTokenStore = new Map<string, { accessToken: string; expiresAt: number; accountEmail?: string }>();

interface AuthRequest extends Request {
  user?: DecodedIdToken;
  userRole?: UserRole;
}

const app = express();
app.use(express.json({ limit: '25mb' }));

// Optional CORS allowlist for cross-origin static preview -> Cloud Run API calls
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && corsAllowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Clinic-Role');
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

async function requireFirebaseAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing Bearer token' });
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    const claimed = (req.headers['x-clinic-role'] as UserRole | undefined) || undefined;
    req.userRole = await resolveVerifiedRole(decoded.uid, decoded.email, decoded.email_verified, claimed);
    next();
  } catch (error) {
    console.error('Firebase token verification error:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}

function requireOwnerOrAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userRole || !['owner', 'admin'].includes(req.userRole)) {
    return res.status(403).json({ error: 'Forbidden: Clinic Owner or Administrator privileges required.' });
  }
  next();
}

function getAppUrl(): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  return 'http://localhost:3000';
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'tawakal-dental-erp',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// -----------------------------------------------------------------------------
// Enterprise Integration Status (Never exposes secret values to frontend)
// -----------------------------------------------------------------------------
app.get('/api/integrations/status', requireFirebaseAuth, requireOwnerOrAdmin, (req: AuthRequest, res: Response) => {
  const { source: keySource } = getBackupEncryptionKey();
  const gcsBucket = process.env.GCS_BACKUP_BUCKET?.trim() || '';
  const gcsKms = process.env.GCS_KMS_KEY_NAME?.trim() || '';
  const wpUrl = process.env.WP_SITE_URL?.trim() || '';
  const wpUser = process.env.WP_APP_USER?.trim() || '';
  const wpPass = process.env.WP_APP_PASSWORD?.trim() || '';
  const msClientId = process.env.MS_CLIENT_ID?.trim() || '';
  const msSecret = process.env.MS_CLIENT_SECRET?.trim() || '';
  const msConnected = Boolean(req.user && msTokenStore.get(req.user.uid));

  res.json({
    encryption: {
      configured: true,
      algorithm: 'AES-256-GCM',
      keyManagement: keySource === 'env_kms' ? 'Secret Manager / Env Key' : 'Server Private Keyring (.vault_master.key)',
    },
    gcs: {
      configured: Boolean(gcsBucket),
      bucketName: gcsBucket || null,
      kmsConfigured: Boolean(gcsKms),
      status: gcsBucket ? 'Configured' : 'Waiting for Credentials (GCS_BACKUP_BUCKET)',
    },
    wordpress: {
      configured: Boolean(wpUrl && wpUser && wpPass),
      siteUrl: wpUrl || null,
      hmacConfigured: Boolean(process.env.WP_BACKUP_HMAC_SECRET),
      status: wpUrl && wpUser && wpPass ? 'Credentials Present (Test Required)' : 'Waiting for Credentials (WP_SITE_URL, WP_APP_USER, WP_APP_PASSWORD)',
    },
    microsoft: {
      configured: Boolean(msClientId && msSecret),
      oauthConnected: msConnected,
      callbackUrl: `${getAppUrl()}/api/microsoft/auth/callback`,
      status: !msClientId || !msSecret
        ? 'Waiting for Credentials (MS_CLIENT_ID, MS_CLIENT_SECRET)'
        : msConnected
        ? 'Connected via Microsoft Graph OAuth 2.0'
        : 'Ready for OAuth Consent',
    },
  });
});

// -----------------------------------------------------------------------------
// Encrypted Backup, Cloud Storage Upload, Verification & Staging Restore
// -----------------------------------------------------------------------------
app.post('/api/backup/create', requireFirebaseAuth, requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, backupType = 'Manual', label, snapshot, uploadToGcs = false, uploadToWordPress = false } = req.body || {};
    if (!orgId || !snapshot || !snapshot.collections) {
      return res.status(400).json({ error: 'Organization ID and clinic snapshot payload are required.' });
    }

    const backupId = `bkp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const { key } = getBackupEncryptionKey();

    const { manifest, envelopeBytes, archiveChecksum, archiveFilename } = buildEncryptedBackupArchive({
      backupId,
      orgId,
      backupType,
      snapshot,
      encryptionKey: key,
    });

    const orgVaultDir = ensureVaultDir(orgId);
    const localArchivePath = path.join(orgVaultDir, archiveFilename);
    fs.writeFileSync(localArchivePath, envelopeBytes, { mode: 0o600 });

    // Optional Google Cloud Storage Upload
    let gcsStored = false;
    let gcsError: string | null = null;
    const gcsBucketName = process.env.GCS_BACKUP_BUCKET?.trim();

    if (uploadToGcs) {
      if (!gcsBucketName) {
        gcsError = 'GCS_BACKUP_BUCKET is not configured on the server.';
      } else {
        try {
          const storage = new Storage();
          const bucket = storage.bucket(gcsBucketName);
          // Non-PII private object path
          const objectPath = `backups/${orgId}/${archiveFilename}`;
          const kmsKeyName = process.env.GCS_KMS_KEY_NAME?.trim() || undefined;
          await bucket.file(objectPath, kmsKeyName ? { kmsKeyName } : undefined).save(envelopeBytes, {
            resumable: false,
            contentType: 'application/octet-stream',
            metadata: {
              metadata: {
                backupId,
                sha256: archiveChecksum,
                algorithm: 'aes-256-gcm',
              },
            },
          });
          gcsStored = true;
        } catch (err) {
          gcsError = err instanceof Error ? err.message : 'Google Cloud Storage upload failed.';
        }
      }
    }

    // Optional WordPress Private Vault Upload
    let wpStored = false;
    let wpError: string | null = null;
    if (uploadToWordPress) {
      const wpResult = await pushEncryptedArchiveToWordPress({
        backupId,
        checksum: archiveChecksum,
        envelopeBytes,
      });
      wpStored = wpResult.ok;
      wpError = wpResult.error || null;
    }

    const destinations = ['Private Encrypted Vault'];
    if (gcsStored) destinations.push(`GCS (${gcsBucketName})`);
    if (wpStored) destinations.push('WordPress Private Vault');

    const failedTargets = [gcsError, wpError].filter(Boolean);

    return res.status(201).json({
      backupId,
      label: label || `${backupType} Encrypted Backup`,
      backupType,
      archiveFilename,
      storagePath: `${orgId}/${archiveFilename}`,
      sizeBytes: envelopeBytes.length,
      recordCount: manifest.totalRecords,
      fileCount: manifest.fileCount,
      checksum: archiveChecksum,
      checksumStatus: 'Verified',
      encryptionStatus: 'AES-256-GCM (Key Isolated)',
      destination: destinations.join(' + '),
      gcsStored,
      wpStored,
      failureReason: failedTargets.length ? failedTargets.join(' | ') : undefined,
      status: failedTargets.length ? 'Verification Required' : 'Verified',
      manifest,
    });
  } catch (err) {
    console.error('Create backup error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Encrypted backup creation failed.' });
  }
});

app.get('/api/backup/download/:orgId/:filename', requireFirebaseAuth, requireOwnerOrAdmin, (req: AuthRequest, res: Response) => {
  const safeOrg = String(req.params.orgId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFile = path.basename(String(req.params.filename || ''));
  if (!safeFile.endsWith('.tawakal.enc')) {
    return res.status(400).json({ error: 'Invalid archive filename.' });
  }
  const fullPath = path.join(ensureVaultDir(safeOrg), safeFile);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Encrypted backup archive not found on server vault.' });
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
  return res.sendFile(fullPath);
});

app.post('/api/backup/restore-staging', requireFirebaseAuth, requireOwnerOrAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { orgId, filename, expectedChecksum } = req.body || {};
    if (!orgId || !filename) {
      return res.status(400).json({ error: 'orgId and archive filename are required.' });
    }
    const safeOrg = String(orgId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFile = path.basename(String(filename));
    const fullPath = path.join(ensureVaultDir(safeOrg), safeFile);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Encrypted backup file not found in server vault.' });
    }

    const envelopeBytes = fs.readFileSync(fullPath);
    const { key } = getBackupEncryptionKey();
    const verification = verifyAndStageRestore({
      envelopeBytes,
      expectedChecksum,
      encryptionKey: key,
    });

    if (!verification.valid) {
      return res.status(422).json({
        ...verification,
        restoredPayload: undefined,
      });
    }

    return res.json(verification);
  } catch (err) {
    console.error('Staging restore error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Staging restore verification failed.' });
  }
});

// -----------------------------------------------------------------------------
// Microsoft Excel (.xlsx) Export & Controlled Import Validation
// -----------------------------------------------------------------------------
app.post('/api/excel/export', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { domain, snapshot } = req.body || {};
    const role = req.userRole || 'receptionist';
    assertExcelExportAuthorized(role, domain as ExcelExportDomain);

    const { buffer, filename, sheetSummary } = await buildDomainExcelWorkbook(
      domain as ExcelExportDomain,
      snapshot,
      { email: req.user?.email || 'staff', role }
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Tawakal-Sheet-Summary', JSON.stringify(sheetSummary));
    return res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Excel export failed.';
    const status = msg.includes('Unauthorized') ? 403 : 400;
    return res.status(status).json({ error: msg });
  }
});

app.post('/api/excel/parse-import', requireFirebaseAuth, requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { fileBase64, targetEntity, existingCodes = [] } = req.body || {};
    if (!fileBase64 || !['patients', 'staff', 'inventory', 'services'].includes(targetEntity)) {
      return res.status(400).json({ error: 'Valid Excel file and allowed master target entity required.' });
    }
    const buffer = Buffer.from(String(fileBase64), 'base64');
    const preview = await parseAndValidateExcelImport({
      buffer,
      targetEntity,
      existingCodes,
    });
    return res.json(preview);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse Excel workbook.' });
  }
});

// -----------------------------------------------------------------------------
// WordPress Public REST API & Private Encrypted Backup Vault
// -----------------------------------------------------------------------------
async function pushEncryptedArchiveToWordPress(params: {
  backupId: string;
  checksum: string;
  envelopeBytes: Buffer;
}): Promise<{ ok: boolean; error?: string; metadata?: unknown }> {
  const wpUrl = process.env.WP_SITE_URL?.trim()?.replace(/\/$/, '');
  const wpUser = process.env.WP_APP_USER?.trim();
  const wpPass = process.env.WP_APP_PASSWORD?.trim();

  if (!wpUrl || !wpUser || !wpPass) {
    return { ok: false, error: 'WordPress credentials (WP_SITE_URL, WP_APP_USER, WP_APP_PASSWORD) are not configured.' };
  }
  if (!wpUrl.startsWith('https://')) {
    return { ok: false, error: 'WordPress backup endpoint strictly requires HTTPS.' };
  }

  const bodyStr = JSON.stringify({
    backupId: params.backupId,
    checksum: params.checksum,
    algorithm: 'aes-256-gcm',
    encryptedArchiveBase64: params.envelopeBytes.toString('base64'),
  });

  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(`${wpUser}:${wpPass}`).toString('base64')}`,
  };
  if (process.env.WP_BACKUP_HMAC_SECRET) {
    headers['X-Tawakal-Timestamp'] = ts;
    headers['X-Tawakal-Signature'] = signWordPressHmac(ts, bodyStr, process.env.WP_BACKUP_HMAC_SECRET);
  }

  try {
    const resp = await fetch(`${wpUrl}/wp-json/tawakal-vault/v1/backups`, {
      method: 'POST',
      headers,
      body: bodyStr,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: (data as { message?: string }).message || `WordPress HTTP ${resp.status}` };
    }
    return { ok: true, metadata: data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'WordPress connection failed.' };
  }
}

app.get('/api/wordpress/plugin-download', requireFirebaseAuth, requireOwnerOrAdmin, (_req: AuthRequest, res: Response) => {
  const pluginPath = path.join(__dirname, 'wordpress-plugin', 'tawakal-private-backup-vault.php');
  if (!fs.existsSync(pluginPath)) {
    return res.status(404).json({ error: 'WordPress plugin file not found.' });
  }
  res.setHeader('Content-Type', 'application/x-php');
  res.setHeader('Content-Disposition', 'attachment; filename="tawakal-private-backup-vault.php"');
  return res.sendFile(pluginPath);
});

app.post('/api/wordpress/test', requireFirebaseAuth, requireOwnerOrAdmin, async (_req: AuthRequest, res: Response) => {
  const wpUrl = process.env.WP_SITE_URL?.trim()?.replace(/\/$/, '');
  const wpUser = process.env.WP_APP_USER?.trim();
  const wpPass = process.env.WP_APP_PASSWORD?.trim();
  if (!wpUrl || !wpUser || !wpPass) {
    return res.status(503).json({
      connected: false,
      error: 'Missing WP_SITE_URL, WP_APP_USER, or WP_APP_PASSWORD in server Secret Manager / environment.',
    });
  }
  if (!wpUrl.startsWith('https://')) {
    return res.status(400).json({ connected: false, error: 'WordPress URL must use HTTPS.' });
  }

  try {
    const authHeader = `Basic ${Buffer.from(`${wpUser}:${wpPass}`).toString('base64')}`;
    const vaultResp = await fetch(`${wpUrl}/wp-json/tawakal-vault/v1/status`, {
      headers: { Authorization: authHeader },
    });
    if (!vaultResp.ok) {
      const txt = await vaultResp.text();
      return res.status(502).json({
        connected: false,
        error: `WordPress vault endpoint returned ${vaultResp.status}: ${txt.slice(0, 180)}`,
      });
    }
    const statusJson = await vaultResp.json();
    return res.json({ connected: true, vaultStatus: statusJson });
  } catch (err) {
    return res.status(502).json({
      connected: false,
      error: err instanceof Error ? err.message : 'Unable to reach WordPress site.',
    });
  }
});

app.post('/api/wordpress/publish-public', requireFirebaseAuth, requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  const { clinicConfig, staff, services, includeApprovedPrices = false } = req.body || {};
  const sanitizedPublic = sanitizePublicWordPressPayload({
    clinicConfig,
    staff,
    services,
    includeApprovedPrices: Boolean(includeApprovedPrices),
  });

  const wpUrl = process.env.WP_SITE_URL?.trim()?.replace(/\/$/, '');
  const wpUser = process.env.WP_APP_USER?.trim();
  const wpPass = process.env.WP_APP_PASSWORD?.trim();
  if (!wpUrl || !wpUser || !wpPass) {
    return res.status(503).json({
      published: false,
      sanitizedPreview: sanitizedPublic,
      error: 'WordPress credentials are not configured. Showing verified zero-PII public payload preview only.',
    });
  }

  try {
    const resp = await fetch(`${wpUrl}/wp-json/wp/v2/pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${wpUser}:${wpPass}`).toString('base64')}`,
      },
      body: JSON.stringify({
        title: `${sanitizedPublic.clinicName} — Clinic Services & Hours`,
        status: 'draft',
        content: `<p>${sanitizedPublic.clinicName} (${sanitizedPublic.publicAddress})</p><p>Hours: ${sanitizedPublic.openingHours}</p>`,
      }),
    });
    if (!resp.ok) {
      return res.status(502).json({
        published: false,
        sanitizedPreview: sanitizedPublic,
        error: `WordPress REST API rejected publish with HTTP ${resp.status}`,
      });
    }
    const page = await resp.json();
    return res.json({ published: true, pageId: (page as { id?: number }).id, sanitizedPreview: sanitizedPublic });
  } catch (err) {
    return res.status(502).json({
      published: false,
      sanitizedPreview: sanitizedPublic,
      error: err instanceof Error ? err.message : 'Failed to publish to WordPress.',
    });
  }
});

app.post('/api/wordpress/upload-backup', requireFirebaseAuth, requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  const { orgId, backupId, filename } = req.body || {};
  if (!orgId || !backupId || !filename) {
    return res.status(400).json({ error: 'orgId, backupId, and filename are required.' });
  }
  const safeOrg = String(orgId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFile = path.basename(String(filename));
  const fullPath = path.join(ensureVaultDir(safeOrg), safeFile);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Encrypted backup file not found in server vault.' });
  }
  const envelopeBytes = fs.readFileSync(fullPath);
  const checksum = computeSha256(envelopeBytes);
  const result = await pushEncryptedArchiveToWordPress({ backupId, checksum, envelopeBytes });
  if (!result.ok) {
    return res.status(502).json({ uploaded: false, error: result.error });
  }
  return res.json({ uploaded: true, metadata: result.metadata });
});

// -----------------------------------------------------------------------------
// Microsoft Graph OAuth 2.0 & Excel Online Sync
// -----------------------------------------------------------------------------
function canExportDailyAppointments(role?: string): boolean {
  return Boolean(role && ['owner', 'admin', 'manager', 'dentist', 'assistant', 'receptionist'].includes(role));
}

app.get('/api/microsoft/status', requireFirebaseAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.MS_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim() || '';
  const tenant = process.env.MS_TENANT_ID?.trim() || 'common';
  const tokenRec = req.user ? msTokenStore.get(req.user.uid) : undefined;
  const oauthConnected = Boolean(tokenRec && tokenRec.expiresAt > Date.now());
  return res.json({
    configured: Boolean(clientId && clientSecret),
    oauthConnected,
    tenantConfigured: Boolean(process.env.MS_TENANT_ID?.trim()),
    tenant,
    callbackUrl: `${getAppUrl()}/api/microsoft/auth/callback`,
  });
});

app.get('/api/microsoft/auth/url', requireFirebaseAuth, (req: AuthRequest, res: Response) => {
  if (!canExportDailyAppointments(req.userRole)) {
    return res.status(403).json({ error: 'Forbidden: Clinic role not authorized for Microsoft Graph export.' });
  }
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
  const tenant = process.env.MS_TENANT_ID?.trim() || 'common';
  if (!clientId || !clientSecret) {
    return res.status(503).json({
      error: 'Microsoft Graph OAuth is not configured (MS_CLIENT_ID / MS_CLIENT_SECRET missing).',
      callbackUrl: `${getAppUrl()}/api/microsoft/auth/callback`,
    });
  }
  const state = Buffer.from(JSON.stringify({ uid: req.user?.uid, ts: Date.now() })).toString('base64url');
  const redirectUri = `${getAppUrl()}/api/microsoft/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'offline_access Files.ReadWrite User.Read',
    state,
  });
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}`;
  return res.json({ url, callbackUrl: redirectUri });
});

app.get(['/api/microsoft/auth/callback', '/api/microsoft/auth/callback/'], async (req: Request, res: Response) => {
  const { code, state, error } = req.query;
  if (error || !code) {
    return res.status(400).send(`<html><body><p>Microsoft OAuth failed: ${String(error || 'Missing code')}</p></body></html>`);
  }
  try {
    const clientId = process.env.MS_CLIENT_ID?.trim() || '';
    const clientSecret = process.env.MS_CLIENT_SECRET?.trim() || '';
    const tenant = process.env.MS_TENANT_ID?.trim() || 'common';
    const redirectUri = `${getAppUrl()}/api/microsoft/auth/callback`;
    const decodedState = state ? JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8')) : {};

    const tokenResp = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: String(code),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenJson = (await tokenResp.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!tokenResp.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error_description || 'Token exchange failed');
    }
    if (decodedState?.uid) {
      msTokenStore.set(decodedState.uid, {
        accessToken: tokenJson.access_token,
        expiresAt: Date.now() + (tokenJson.expires_in || 3600) * 1000,
      });
    }
    return res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'microsoft' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Microsoft Graph connected. You may close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send(`<html><body><p>Microsoft OAuth Error: ${err instanceof Error ? err.message : 'Unknown error'}</p></body></html>`);
  }
});

app.post('/api/microsoft/test', requireFirebaseAuth, requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  const tokenRec = req.user ? msTokenStore.get(req.user.uid) : undefined;
  if (!tokenRec || tokenRec.expiresAt < Date.now()) {
    return res.status(503).json({
      connected: false,
      error: 'Microsoft Graph OAuth token not connected. Configure MS_CLIENT_ID / MS_CLIENT_SECRET and complete Connect Microsoft Account.',
    });
  }
  try {
    const driveResp = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
      headers: { Authorization: `Bearer ${tokenRec.accessToken}` },
    });
    if (!driveResp.ok) {
      return res.status(502).json({ connected: false, error: `Microsoft Graph returned HTTP ${driveResp.status}` });
    }
    const driveData = await driveResp.json();
    return res.json({ connected: true, driveType: (driveData as { driveType?: string }).driveType });
  } catch (err) {
    return res.status(502).json({ connected: false, error: err instanceof Error ? err.message : 'Graph check failed' });
  }
});

app.post('/api/microsoft/excel/export-daily-appointments', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const role = req.userRole || 'receptionist';
    assertExcelExportAuthorized(role, 'daily_appointments');

    const { snapshot, folderName = 'TawakalDentalERP/DailyAppointments' } = req.body || {};
    if (!snapshot || !Array.isArray(snapshot.appointments)) {
      return res.status(400).json({ error: 'Valid daily appointment snapshot is required.' });
    }

    const { buffer, filename, sheetSummary } = await buildDomainExcelWorkbook(
      'daily_appointments',
      snapshot,
      { email: req.user?.email || 'staff', role }
    );

    const clientId = process.env.MS_CLIENT_ID?.trim();
    const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      return res.status(503).json({
        synced: false,
        configured: false,
        authRequired: false,
        filename,
        sheetSummary,
        error: 'Microsoft Graph environment variables (MS_CLIENT_ID / MS_CLIENT_SECRET) are not configured on the server.',
      });
    }

    const tokenRec = req.user ? msTokenStore.get(req.user.uid) : undefined;
    if (!tokenRec || tokenRec.expiresAt < Date.now()) {
      return res.status(401).json({
        synced: false,
        configured: true,
        authRequired: true,
        filename,
        sheetSummary,
        error: 'Microsoft Graph OAuth token not connected or expired. Connect your Microsoft account to sync to OneDrive.',
      });
    }

    const safeFolder = String(folderName)
      .split('/')
      .map((seg) => seg.replace(/[^a-zA-Z0-9_-]/g, '_'))
      .filter(Boolean)
      .join('/') || 'TawakalDentalERP';
    const drivePath = `${safeFolder}/${filename}`;
    const graphEndpoint = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURI(drivePath)}:/content`;

    const graphResp = await fetch(graphEndpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenRec.accessToken}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: new Uint8Array(buffer),
    });

    const graphJson = (await graphResp.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      webUrl?: string;
      size?: number;
      error?: { message?: string };
    };

    if (!graphResp.ok) {
      return res.status(502).json({
        synced: false,
        configured: true,
        authRequired: graphResp.status === 401,
        filename,
        sheetSummary,
        error: graphJson.error?.message || `Microsoft Graph upload failed (HTTP ${graphResp.status}).`,
      });
    }

    return res.json({
      synced: true,
      filename,
      drivePath,
      sheetSummary,
      driveItem: {
        id: graphJson.id || null,
        name: graphJson.name || filename,
        webUrl: graphJson.webUrl || null,
        size: graphJson.size || buffer.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Daily appointment OneDrive export failed.';
    return res.status(msg.includes('Unauthorized') ? 403 : 500).json({ synced: false, error: msg });
  }
});

// -----------------------------------------------------------------------------
// Existing AI Voice Receptionist & Executive Assistant Routes
// -----------------------------------------------------------------------------
app.post('/api/ai/receptionist', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { message, history = [], clinicContext } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message text is required.' });
    }

    const emergencyDetected = detectEmergencyTriage(message);
    if (emergencyDetected) {
      return res.json({
        reply:
          'Assalam-o-Alaikum. Aapne jo alamat batayi hain (severe swelling, bleeding, ya trauma) woh urgent medical attention maangti hain. Main ek AI receptionist hoon aur medical diagnosis nahi kar sakti. Main aapki call foran clinic ke human staff ko transfer kar rahi hoon — agar saans lene ya nigalne mein takleef ho to barah-e-karam foran qareebi hospital emergency tashreef le jayein.',
        intent: 'Emergency Escalation',
        emergencyFlag: true,
        transferToHuman: true,
        bookingAction: null,
      });
    }

    if (!ai) {
      return res.status(503).json({
        error: 'Gemini AI service is not configured on the server (GEMINI_API_KEY missing).',
      });
    }

    const systemInstruction = `You are the official AI Phone Receptionist for ${clinicContext?.clinicName || 'Tawakal Dental Clinic'} in ${clinicContext?.location || 'Saudabad, Malir, Karachi'}.
STRICT CLINICAL SAFETY & PRIVACY RULES:
1. Always identify yourself honestly as an AI receptionist if asked, and never pretend to be a dentist.
2. Support English, Urdu, and Roman Urdu naturally based on the caller's language.
3. NEVER diagnose dental conditions, NEVER prescribe or suggest medications/dosages, and NEVER guarantee treatment outcomes.
4. If the caller mentions severe swelling, uncontrollable bleeding, trauma, or breathing/swallowing difficulty, immediately trigger human handover and urgent care guidance.
5. Only quote services, doctors, opening hours, and prices explicitly provided in the live clinic context below. If opening hours or prices are not yet configured, state politely that a human receptionist will confirm them.

LIVE CLINIC CONTEXT:
- Opening Hours: ${clinicContext?.openingHours || 'Not yet configured by clinic owner'}
- Phone: ${clinicContext?.phone || 'Not configured'}
- Available Doctors: ${JSON.stringify(clinicContext?.doctors || [])}
- Active Services: ${JSON.stringify(clinicContext?.services || [])}
- Available Slots Today/Requested: ${JSON.stringify(clinicContext?.availableSlots || [])}`;

    const conversationText = [
      ...history.slice(-6).map((h: { role: string; text: string }) => `${h.role}: ${h.text}`),
      `caller: ${message}`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: conversationText,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            intent: { type: Type.STRING },
            language: { type: Type.STRING },
            transferToHuman: { type: Type.BOOLEAN },
            suggestedBooking: {
              type: Type.OBJECT,
              properties: {
                patientName: { type: Type.STRING },
                phone: { type: Type.STRING },
                serviceName: { type: Type.STRING },
                doctorName: { type: Type.STRING },
                date: { type: Type.STRING },
                startTime: { type: Type.STRING },
              },
            },
          },
          required: ['reply', 'intent', 'language', 'transferToHuman'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({
      reply: parsed.reply || 'Assalam-o-Alaikum, how may I assist you with an appointment at Tawakal Dental Clinic?',
      intent: parsed.intent || 'General Inquiry',
      language: parsed.language || 'English',
      emergencyFlag: false,
      transferToHuman: Boolean(parsed.transferToHuman),
      suggestedBooking: parsed.suggestedBooking || null,
    });
  } catch (error) {
    console.error('AI Receptionist error:', error);
    return res.status(500).json({ error: 'AI Receptionist request failed. Please transfer to human staff.' });
  }
});

app.post('/api/ai/assistant', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { question, metricsSnapshot } = req.body || {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required.' });
    }
    if (!ai) {
      return res.status(503).json({
        error: 'Gemini AI service is not configured on the server (GEMINI_API_KEY missing).',
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Authorized Clinic Metrics Snapshot:\n${JSON.stringify(metricsSnapshot || {}, null, 2)}\n\nClinic Executive Question: ${question}`,
      config: {
        systemInstruction:
          'You are the Executive Operations Assistant for Tawakal Dental Clinic ERP. Answer concisely using ONLY the supplied verified metrics snapshot. Never invent figures, patients, or revenues. Never provide medical diagnoses or prescriptions.',
      },
    });

    return res.json({ answer: response.text || 'No response generated.' });
  } catch (error) {
    console.error('AI Executive Assistant error:', error);
    return res.status(500).json({ error: 'Failed to query AI Clinic Assistant.' });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Tawakal Dental Clinic ERP server listening on port ${PORT}`);
  });
}

startServer();
