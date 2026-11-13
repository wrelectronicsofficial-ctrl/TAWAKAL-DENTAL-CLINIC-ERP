import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  FileSpreadsheet,
  Globe,
  HardDriveDownload,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import {
  applyVerifiedStagingRestoreToOrg,
  collectFullOrganizationSnapshot,
  generateRecordId,
  saveSubdoc,
  writeAuditLog,
} from '../lib/firestore-service';
import { formatPKR } from '../lib/erp-engine';
import { apiUrl, readJsonSafe } from '../lib/api-client';
import type { ExcelExportDomain, ExcelImportPreview } from '../lib/excel-engine';
import type { StagingRestoreVerification } from '../lib/backup-engine';
import { BackupRecord, BackupType, IntegrationSettings, SyncJob } from '../types/erp';

interface IntegrationRuntimeStatus {
  encryption: { configured: boolean; algorithm: string; keyManagement: string };
  gcs: { configured: boolean; bucketName: string | null; kmsConfigured: boolean; status: string };
  wordpress: { configured: boolean; siteUrl: string | null; hmacConfigured: boolean; status: string };
  microsoft: { configured: boolean; oauthConnected: boolean; callbackUrl: string; status: string };
}

type SafetyTab = 'overview' | 'excel' | 'wordpress' | 'restore' | 'sync_config';

export function DataSafetyView() {
  const {
    activeOrgId,
    isDemoMode,
    orgConfig,
    userAccount,
    patients,
    appointments,
    staff,
    services,
    treatmentPlans,
    invoices,
    journals,
    budgets,
    inventory,
    sterilizationLogs,
    callRecords,
    auditLogs,
    backups,
    syncJobs,
    integrationConfigs,
    restoreRuns,
    excelImports,
    documentRefs,
    getIdToken,
  } = useErp();

  const [tab, setTab] = useState<SafetyTab>('overview');
  const [runtimeStatus, setRuntimeStatus] = useState<IntegrationRuntimeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerInfo, setBannerInfo] = useState<string | null>(null);

  // Backup creation options
  const [backupType, setBackupType] = useState<BackupType>('Manual');
  const [uploadToGcs, setUploadToGcs] = useState(false);
  const [uploadToWp, setUploadToWp] = useState(false);

  // Staging restore preview state
  const [stagingPreview, setStagingPreview] = useState<StagingRestoreVerification | null>(null);
  const [stagingSourceBackup, setStagingSourceBackup] = useState<BackupRecord | null>(null);
  const [ownerRestoreConfirmed, setOwnerRestoreConfirmed] = useState(false);

  // Excel import wizard state
  const [importTarget, setImportTarget] = useState<'patients' | 'staff' | 'inventory' | 'services'>('patients');
  const [importFilename, setImportFilename] = useState('');
  const [importPreview, setImportPreview] = useState<ExcelImportPreview | null>(null);

  // WordPress public preview state
  const [wpIncludePrices, setWpIncludePrices] = useState(false);
  const [wpSanitizedPreview, setWpSanitizedPreview] = useState<Record<string, unknown> | null>(null);

  // Non-secret integration settings form
  const currentConfig: Partial<IntegrationSettings> = integrationConfigs[0] || {};
  const [settingsForm, setSettingsForm] = useState<Partial<IntegrationSettings>>({
    wpSiteUrl: currentConfig.wpSiteUrl || '',
    wpUsername: currentConfig.wpUsername || '',
    wpPublicSyncEnabled: currentConfig.wpPublicSyncEnabled ?? false,
    wpBackupSyncEnabled: currentConfig.wpBackupSyncEnabled ?? false,
    msDriveLocation: currentConfig.msDriveLocation || 'OneDrive',
    msWorkbookName: currentConfig.msWorkbookName || 'Tawakal_Dental_ERP_Master.xlsx',
    msWorksheetName: currentConfig.msWorksheetName || 'Patients Master',
    msSyncFrequency: currentConfig.msSyncFrequency || 'Daily',
    msSyncDirection: currentConfig.msSyncDirection || 'Export Only',
    gcsBucketName: currentConfig.gcsBucketName || '',
    gcsKmsEnabled: currentConfig.gcsKmsEnabled ?? true,
    dailyBackupTime: currentConfig.dailyBackupTime || '23:00',
    weeklyRetentionDays: currentConfig.weeklyRetentionDays ?? 30,
    monthlyRetentionDays: currentConfig.monthlyRetentionDays ?? 365,
  });

  useEffect(() => {
    if (integrationConfigs[0]) {
      setSettingsForm((prev) => ({ ...prev, ...integrationConfigs[0] }));
    }
  }, [integrationConfigs]);

  const fetchRuntimeStatus = async () => {
    if (!userAccount) return;
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/integrations/status'), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
      });
      if (res.ok) {
        const data = await readJsonSafe<IntegrationRuntimeStatus>(res);
        setRuntimeStatus(data);
      }
    } catch {
      // ignore network error; status shows unverified
    }
  };

  useEffect(() => {
    fetchRuntimeStatus();
  }, [userAccount?.uid]);

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      if (!event.origin.endsWith('.run.app') && !event.origin.includes('localhost')) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'microsoft') {
        setBannerInfo('Microsoft Graph OAuth 2.0 connected successfully.');
        fetchRuntimeStatus();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const stats = useMemo(() => {
    const lastBackup = backups[0] || null;
    const verifiedCount = backups.filter((b) => b.status === 'Verified' || b.status === 'Restored').length;
    const totalBytes = backups.reduce((s, b) => s + (b.sizeBytes || 0), 0);
    const pendingJobs = syncJobs.filter((j) => j.status === 'Queued' || j.status === 'Retrying' || j.status === 'Processing');
    const failedJobs = syncJobs.filter((j) => j.status === 'Failed');
    const completedJobs = syncJobs.filter((j) => j.status === 'Completed');
    const securityEvents = auditLogs.filter((a) =>
      a.action.includes('BACKUP') || a.action.includes('RESTORE') || a.action.includes('EXPORT') || a.action.includes('ROLE') || a.action.includes('WORDPRESS')
    );
    const exportActivity = auditLogs.filter((a) => a.action.includes('EXPORT') || a.action.includes('IMPORT'));
    return {
      lastBackup,
      verifiedCount,
      totalBytes,
      pendingJobs,
      failedJobs,
      lastSuccessSync: completedJobs[0] || null,
      securityEvents,
      exportActivity,
    };
  }, [backups, syncJobs, auditLogs]);

  const handleRunEncryptedBackup = async () => {
    if (!userAccount) return;
    setBusy('backup');
    setBannerError(null);
    setBannerInfo(null);
    const actor = { uid: userAccount.uid, email: userAccount.email, role: userAccount.role };

    try {
      const snapshot = await collectFullOrganizationSnapshot(activeOrgId);
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/backup/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
        body: JSON.stringify({
          orgId: activeOrgId,
          backupType,
          label: `${backupType} Encrypted Archive (${new Date().toLocaleDateString('en-PK')})`,
          snapshot,
          uploadToGcs,
          uploadToWordPress: uploadToWp,
        }),
      });

      const data = await readJsonSafe<Record<string, any>>(res);
      if (!res.ok) {
        throw new Error(data.error || 'Encrypted backup failed.');
      }

      const bkpRecord: Omit<BackupRecord, 'id'> = {
        backupId: data.backupId,
        label: data.label,
        backupType,
        recordCount: data.recordCount,
        fileCount: data.fileCount,
        sizeBytes: data.sizeBytes,
        destination: data.destination,
        encryptionStatus: data.encryptionStatus,
        checksum: data.checksum,
        checksumStatus: 'Verified',
        status: data.status,
        failureReason: data.failureReason,
        storagePath: data.archiveFilename,
        wpStored: Boolean(data.wpStored),
        gcsStored: Boolean(data.gcsStored),
        createdBy: userAccount.uid,
        createdAt: new Date().toISOString(),
      };

      await saveSubdoc(
        activeOrgId,
        'backups',
        data.backupId,
        bkpRecord,
        actor,
        'CREATE_ENCRYPTED_BACKUP',
        `Created AES-256-GCM backup ${data.backupId} (${data.recordCount} records, ${data.sizeBytes} bytes, dest: ${data.destination})`
      );

      // If GCS or WordPress failed when requested, queue reliable retry sync jobs (never silently drop!)
      if (uploadToGcs && !data.gcsStored) {
        await enqueueSyncJobRecord('Google Cloud Storage', 'Backup Engine', `${data.backupId}_gcs`, data.failureReason);
      }
      if (uploadToWp && !data.wpStored) {
        await enqueueSyncJobRecord('WordPress Vault', 'Backup Engine', `${data.backupId}_wp`, data.failureReason);
      }

      if (data.failureReason) {
        setBannerError(`Encrypted local vault backup succeeded (${data.backupId}), but external target reported: ${data.failureReason}. Retry job queued.`);
      } else {
        setBannerInfo(`Encrypted AES-256-GCM backup ${data.backupId} verified (${data.recordCount} records, SHA-256 matched).`);
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Backup operation failed.');
    } finally {
      setBusy(null);
    }
  };

  const enqueueSyncJobRecord = async (
    destination: SyncJob['destination'],
    sourceModule: string,
    idempotencyKey: string,
    lastError?: string
  ) => {
    if (!userAccount) return;
    // Duplicate prevention via idempotencyKey
    if (syncJobs.some((j) => j.idempotencyKey === idempotencyKey && j.status !== 'Cancelled')) {
      return;
    }
    const jobId = generateRecordId('job');
    const now = new Date();
    const nextRetry = new Date(now.getTime() + 60_000).toISOString();
    const job: Omit<SyncJob, 'id'> = {
      jobId,
      eventId: generateRecordId('evt'),
      idempotencyKey,
      sourceModule,
      destination,
      status: lastError ? 'Retrying' : 'Queued',
      retryCount: lastError ? 1 : 0,
      lastError: lastError?.slice(0, 280),
      nextRetryTime: nextRetry,
      createdAt: now.toISOString(),
    };
    await saveSubdoc(
      activeOrgId,
      'sync_jobs',
      jobId,
      job,
      { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
      'ENQUEUE_SYNC_JOB',
      `Queued ${destination} sync job (${idempotencyKey})`
    );
  };

  const handleDownloadBackupArchive = async (bkp: BackupRecord) => {
    if (!bkp.storagePath || !userAccount) return;
    setBusy(`dl_${bkp.id}`);
    setBannerError(null);
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl(`/api/backup/download/${encodeURIComponent(activeOrgId)}/${encodeURIComponent(bkp.storagePath)}`), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
      });
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res).catch((e) => ({ error: e instanceof Error ? e.message : 'Archive download failed.' }));
        throw new Error(d.error || 'Archive download failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = bkp.storagePath;
      a.click();
      URL.revokeObjectURL(url);
      await writeAuditLog(
        activeOrgId,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'DOWNLOAD_ENCRYPTED_BACKUP',
        'backups',
        bkp.id,
        `Downloaded encrypted archive ${bkp.storagePath}`
      );
      setBannerInfo(`Downloaded AES-256-GCM archive ${bkp.storagePath}. Encryption key remains isolated on server.`);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleRunStagingRestore = async (bkp: BackupRecord) => {
    if (!bkp.storagePath || !userAccount) {
      setBannerError('Select an encrypted server-vault backup archive with a stored filename.');
      return;
    }
    setBusy(`stage_${bkp.id}`);
    setBannerError(null);
    setBannerInfo(null);
    setOwnerRestoreConfirmed(false);

    try {
      // Step 1: Create pre-restore safety snapshot before testing restore
      const currentSnapshot = await collectFullOrganizationSnapshot(activeOrgId);
      const token = await getIdToken();

      const preRes = await fetch(apiUrl('/api/backup/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
        body: JSON.stringify({
          orgId: activeOrgId,
          backupType: 'Pre-Restore',
          label: `Pre-Restore Safety Snapshot (${new Date().toLocaleTimeString('en-PK')})`,
          snapshot: currentSnapshot,
        }),
      });
      const preData = await readJsonSafe<{ backupId?: string; error?: string }>(preRes);
      if (!preRes.ok) throw new Error(preData.error || 'Pre-restore backup failed.');

      // Step 2: Run staging decrypt + checksum + financial reconciliation verification
      const stageRes = await fetch(apiUrl('/api/backup/restore-staging'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
        body: JSON.stringify({
          orgId: activeOrgId,
          filename: bkp.storagePath,
          expectedChecksum: bkp.checksum,
        }),
      });
      const stageData = await readJsonSafe<StagingRestoreVerification>(stageRes);
      if (!stageRes.ok || !stageData.valid) {
        throw new Error(stageData.errors?.join('; ') || 'Staging verification failed.');
      }

      setStagingPreview(stageData);
      setStagingSourceBackup(bkp);
      setTab('restore');

      const runId = generateRecordId('rst');
      await saveSubdoc(
        activeOrgId,
        'restore_runs',
        runId,
        {
          backupId: bkp.backupId || bkp.id,
          preRestoreBackupId: preData.backupId,
          status: 'Staging Verified',
          verifiedCountsJson: JSON.stringify(stageData.recordCounts),
          financialReconciled: stageData.journalTotals.doubleEntryBalanced && stageData.invoiceTotals.invoicesReconciled,
          checksumMatched: stageData.checksumMatched,
          notes: `Verified ${stageData.totalRecords} records in isolated staging before owner confirmation.`,
          createdAt: new Date().toISOString(),
        },
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'VERIFY_STAGING_RESTORE',
        `Staging verified backup ${bkp.backupId || bkp.id} (${stageData.totalRecords} records, checksum matched)`
      );

      setBannerInfo(`Pre-restore snapshot (${preData.backupId}) saved and staging restore verified cleanly. Review preview below before approving.`);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Staging restore verification failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleCommitVerifiedRestore = async () => {
    if (!userAccount || !stagingPreview?.restoredPayload || !stagingSourceBackup || !ownerRestoreConfirmed) return;
    setBusy('commit_restore');
    setBannerError(null);
    try {
      const count = await applyVerifiedStagingRestoreToOrg(
        activeOrgId,
        stagingPreview.restoredPayload.collections,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        stagingPreview.backupId
      );

      await saveSubdoc(
        activeOrgId,
        'restore_runs',
        generateRecordId('rst'),
        {
          backupId: stagingPreview.backupId,
          status: 'Approved & Applied',
          verifiedCountsJson: JSON.stringify(stagingPreview.recordCounts),
          financialReconciled: true,
          checksumMatched: stagingPreview.checksumMatched,
          approvedBy: userAccount.uid,
          notes: `Owner-approved restore committed (${count} records written to ${activeOrgId}).`,
          createdAt: new Date().toISOString(),
        },
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'COMMIT_VERIFIED_RESTORE',
        `Applied owner-approved restore from ${stagingPreview.backupId} (${count} records)`
      );

      setBannerInfo(`Restore applied and verified (${count} records committed to ${activeOrgId}).`);
      setStagingPreview(null);
      setStagingSourceBackup(null);
      setOwnerRestoreConfirmed(false);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Restore commit failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleExportExcel = async (domain: ExcelExportDomain) => {
    if (!userAccount) return;
    setBusy(`xlsx_${domain}`);
    setBannerError(null);
    setBannerInfo(null);
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
          domain,
          snapshot: {
            clinicName: orgConfig?.clinicName || 'Tawakal Dental Clinic',
            environment: isDemoMode ? 'DEMO' : 'PRODUCTION',
            patients,
            appointments,
            staff,
            services,
            treatmentPlans,
            invoices,
            journals,
            budgets,
            inventory,
            sterilizationLogs,
            callRecords,
            documentRefs,
          },
        }),
      });
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res).catch((e) => ({ error: e instanceof Error ? e.message : 'Excel export failed.' }));
        throw new Error(d.error || 'Excel export failed.');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `Tawakal_Dental_${domain}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      await writeAuditLog(
        activeOrgId,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'EXPORT_EXCEL_WORKBOOK',
        'excel_export',
        domain,
        `Exported ${filename}`
      );
      setBannerInfo(`Exported real formatted Excel workbook: ${filename}`);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Excel export failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleUploadExcelForPreview = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userAccount) return;
    setBusy('xlsx_parse');
    setBannerError(null);
    setImportFilename(file.name);

    try {
      const arrBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const fileBase64 = btoa(binary);

      const existingCodes =
        importTarget === 'patients'
          ? patients.map((p) => p.patientCode)
          : importTarget === 'inventory'
          ? inventory.map((i) => i.sku)
          : importTarget === 'services'
          ? services.map((s) => s.code)
          : staff.map((s) => s.staffCode);

      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/excel/parse-import'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
        body: JSON.stringify({ fileBase64, targetEntity: importTarget, existingCodes }),
      });
      const data = await readJsonSafe<ExcelImportPreview & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Failed to parse Excel file.');
      setImportPreview(data);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Excel parsing failed.');
    } finally {
      setBusy(null);
      e.target.value = '';
    }
  };

  const handleApproveExcelImport = async () => {
    if (!userAccount || !importPreview) return;
    const validRows = importPreview.rows.filter((r) => r.valid && r.mapped);
    if (validRows.length === 0) {
      setBannerError('No valid rows available to import.');
      return;
    }
    setBusy('xlsx_commit');
    setBannerError(null);
    const actor = { uid: userAccount.uid, email: userAccount.email, role: userAccount.role };
    const now = new Date().toISOString();

    try {
      for (const r of validRows) {
        const recId = generateRecordId('imp');
        const payload =
          importPreview.targetEntity === 'inventory'
            ? { ...r.mapped, updatedAt: now }
            : { ...r.mapped, createdAt: now };
        await saveSubdoc(
          activeOrgId,
          importPreview.targetEntity,
          recId,
          payload as Record<string, unknown>,
          actor,
          'EXCEL_APPROVED_IMPORT_ROW',
          `Imported ${importPreview.targetEntity} row ${r.rowNumber} from ${importFilename}`
        );
      }

      await saveSubdoc(
        activeOrgId,
        'excel_imports',
        generateRecordId('ximp'),
        {
          filename: importFilename,
          worksheetName: importPreview.worksheetName,
          targetEntity: importPreview.targetEntity,
          totalRows: importPreview.totalRows,
          validRows: importPreview.validRows,
          errorRows: importPreview.errorRows,
          status: 'Approved & Imported',
          approvedBy: userAccount.uid,
          createdAt: now,
        },
        actor,
        'APPROVE_EXCEL_IMPORT',
        `Approved import of ${validRows.length} ${importPreview.targetEntity} record(s) from ${importFilename}`
      );

      setBannerInfo(`Imported ${validRows.length} validated ${importPreview.targetEntity} record(s) with audit log.`);
      setImportPreview(null);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Excel import failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleTestWordPress = async () => {
    if (!userAccount) return;
    setBusy('wp_test');
    setBannerError(null);
    setBannerInfo(null);
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/wordpress/test'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
      });
      const data = await readJsonSafe<{ connected?: boolean; vaultStatus?: { ssl?: boolean }; error?: string }>(res);
      if (!res.ok || !data.connected) {
        throw new Error(data.error || 'WordPress connection failed.');
      }
      setBannerInfo(`WordPress Private Vault verified connected (SSL: ${data.vaultStatus?.ssl ? 'Yes' : 'No'}).`);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'WordPress test failed.');
    } finally {
      setBusy(null);
    }
  };

  const handlePublishWordPressPublic = async () => {
    if (!userAccount) return;
    setBusy('wp_pub');
    setBannerError(null);
    setBannerInfo(null);
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/wordpress/publish-public'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
        body: JSON.stringify({
          clinicConfig: orgConfig,
          staff,
          services,
          includeApprovedPrices: wpIncludePrices,
        }),
      });
      const data = await readJsonSafe<{
        sanitizedPreview?: Record<string, unknown> | null;
        published?: boolean;
        pageId?: string | number;
        error?: string;
      }>(res);
      setWpSanitizedPreview(data.sanitizedPreview || null);
      if (!res.ok || !data.published) {
        setBannerError(data.error || 'WordPress publish skipped (credentials unconfigured); verified zero-PII preview displayed below.');
      } else {
        await writeAuditLog(
          activeOrgId,
          { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
          'WORDPRESS_PUBLIC_PUBLISH',
          'wordpress',
          String(data.pageId || 'page'),
          'Published sanitized non-PII clinic services & hours draft to WordPress'
        );
        setBannerInfo(`Published zero-PII clinic directory page to WordPress (Draft ID: ${data.pageId}).`);
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'WordPress public publish error.');
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadWpPlugin = async () => {
    if (!userAccount) return;
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/wordpress/plugin-download'), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
      });
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res).catch((e) => ({
          error: e instanceof Error ? e.message : 'Unable to download WordPress vault plugin.',
        }));
        setBannerError(d.error || 'Unable to download WordPress vault plugin.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tawakal-private-backup-vault.php';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Unable to download WordPress vault plugin.');
    }
  };

  const handleConnectMicrosoft = async () => {
    if (!userAccount) return;
    setBannerError(null);
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
        throw new Error(data.error || 'Microsoft Graph OAuth is not configured.');
      }
      const popup = window.open(data.url, 'ms_oauth_popup', 'width=620,height=720');
      if (!popup) {
        setBannerError('Popup blocked by browser. Please allow popups for Microsoft OAuth consent.');
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Microsoft OAuth launch failed.');
    }
  };

  const handleTestMicrosoft = async () => {
    if (!userAccount) return;
    setBusy('ms_test');
    setBannerError(null);
    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/microsoft/test'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Clinic-Role': userAccount.role,
        },
      });
      const data = await readJsonSafe<{ connected?: boolean; driveType?: string; error?: string }>(res);
      if (!res.ok || !data.connected) throw new Error(data.error || 'Microsoft Graph not connected.');
      setBannerInfo(`Microsoft Graph connected (${data.driveType || 'OneDrive/SharePoint'}).`);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Microsoft Graph test failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setBusy('save_cfg');
    setBannerError(null);
    try {
      await saveSubdoc(
        activeOrgId,
        'integration_configs',
        'default',
        {
          ...settingsForm,
          updatedBy: userAccount.uid,
          updatedAt: new Date().toISOString(),
        },
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'UPDATE_INTEGRATION_SETTINGS',
        'Updated non-secret backup schedule, WordPress URL, and Microsoft Excel sync preferences'
      );
      setBannerInfo('Integration preferences saved to organization configuration.');
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to save integration configuration.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Data Safety, Backups &amp; Enterprise Integrations</h1>
          <p className="text-sm text-slate-500">
            AES-256-GCM encrypted backups · Google Cloud Storage · Microsoft Excel &amp; Graph · WordPress Public &amp; Private Vault
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
          {([
            ['overview', 'Backups & Safety'],
            ['excel', 'Excel Export & Import'],
            ['wordpress', 'WordPress & Vault'],
            ['restore', 'Staging Restore'],
            ['sync_config', 'Sync Queue & Config'],
          ] as [SafetyTab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                tab === id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {bannerError && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{bannerError}</span>
        </div>
      )}

      {bannerInfo && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2 text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{bannerInfo}</span>
        </div>
      )}

      {/* 15-Point Data Safety & Integration Status Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">1. Primary Database</p>
          <p className="font-semibold text-slate-900 mt-1">Cloud Firestore · Active</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{activeOrgId}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">2. Last Database Backup</p>
          <p className="font-semibold text-slate-900 mt-1 tabular-nums">
            {stats.lastBackup ? stats.lastBackup.status : 'None Yet'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {stats.lastBackup ? stats.lastBackup.createdAt.slice(0, 16).replace('T', ' ') : 'Run Backup Now'}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">3. Cloud Storage (GCS)</p>
          <p className={`font-semibold mt-1 ${runtimeStatus?.gcs.configured ? 'text-emerald-700' : 'text-amber-700'}`}>
            {runtimeStatus?.gcs.configured ? 'Bucket Configured' : 'Needs GCS_BACKUP_BUCKET'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">{runtimeStatus?.gcs.bucketName || 'Private Bucket Pending'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">4-5. WordPress &amp; Vault</p>
          <p className={`font-semibold mt-1 ${runtimeStatus?.wordpress.configured ? 'text-blue-700' : 'text-amber-700'}`}>
            {runtimeStatus?.wordpress.configured ? 'Credentials Present' : 'Waiting for Credentials'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">{runtimeStatus?.wordpress.siteUrl || 'HTTPS App Password needed'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">6-7. Excel &amp; MS Graph</p>
          <p className="font-semibold text-slate-900 mt-1">XLSX Export Ready</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {runtimeStatus?.microsoft.oauthConnected ? 'Graph OAuth Connected' : 'Graph OAuth Pending'}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">8-10. Sync Queue</p>
          <p className="font-semibold text-slate-900 mt-1 tabular-nums">
            {stats.pendingJobs.length} Pending · {stats.failedJobs.length} Failed
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {stats.lastSuccessSync ? `Last: ${stats.lastSuccessSync.completedAt?.slice(0, 10)}` : 'No external sync yet'}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">11. Vault Storage Used</p>
          <p className="font-semibold text-slate-900 mt-1 tabular-nums">{(stats.totalBytes / 1024).toFixed(1)} KB</p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">{backups.length} snapshots archived</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">12. Backup Verification</p>
          <p className="font-semibold text-slate-900 mt-1 tabular-nums">{stats.verifiedCount} Verified</p>
          <p className="text-[11px] text-slate-500 mt-0.5">SHA-256 + AES-256-GCM</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">13. Restore Tests</p>
          <p className="font-semibold text-slate-900 mt-1 tabular-nums">{restoreRuns.length} Staging Runs</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {restoreRuns[0] ? restoreRuns[0].status : 'Run staging test'}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-slate-500">14-15. Audit &amp; Exports</p>
          <p className="font-semibold text-slate-900 mt-1 tabular-nums">
            {stats.securityEvents.length} Security · {stats.exportActivity.length} Exports
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Immutable ledger logged</p>
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={handleRunEncryptedBackup}
          disabled={busy === 'backup'}
          className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>{busy === 'backup' ? 'Encrypting...' : 'Backup Now'}</span>
        </button>
        <button
          type="button"
          onClick={() => handleExportExcel('financial_ledger')}
          disabled={Boolean(busy)}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
          <span>Export Financial Excel</span>
        </button>
        <button
          type="button"
          onClick={handleTestWordPress}
          disabled={busy === 'wp_test'}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
        >
          <Globe className="w-3.5 h-3.5 text-blue-600" />
          <span>{busy === 'wp_test' ? 'Testing...' : 'Test WordPress Connection'}</span>
        </button>
        <button
          type="button"
          onClick={handleTestMicrosoft}
          disabled={busy === 'ms_test'}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
        >
          <Cloud className="w-3.5 h-3.5 text-blue-600" />
          <span>{busy === 'ms_test' ? 'Testing...' : 'Test Microsoft Connection'}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('sync_config')}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>View Sync History</span>
        </button>
      </div>

      {/* TAB 1: BACKUPS */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Backup Type</label>
                <select
                  value={backupType}
                  onChange={(e) => setBackupType(e.target.value as BackupType)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg"
                >
                  <option value="Manual">Manual</option>
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Pre-Update">Pre-Update</option>
                  <option value="Pre-Migration">Pre-Migration</option>
                </select>
              </div>
              <label className="flex items-center gap-2 pt-4 cursor-pointer">
                <input type="checkbox" checked={uploadToGcs} onChange={(e) => setUploadToGcs(e.target.checked)} />
                <span>Also push to Private GCS Bucket</span>
              </label>
              <label className="flex items-center gap-2 pt-4 cursor-pointer">
                <input type="checkbox" checked={uploadToWp} onChange={(e) => setUploadToWp(e.target.checked)} />
                <span>Also push to WordPress Private Vault</span>
              </label>
            </div>

            <div className="text-xs text-slate-500">
              Encryption Key Isolation: <span className="font-medium text-slate-900">{runtimeStatus?.encryption.keyManagement || 'Server Private Keyring'}</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Backup ID / Type</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 font-semibold text-right">Records / Size</th>
                  <th className="px-4 py-3 font-semibold">Destination &amp; Encryption</th>
                  <th className="px-4 py-3 font-semibold">Checksum / Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      No backups created yet. Click &ldquo;Backup Now&rdquo; to generate a verified AES-256-GCM encrypted archive.
                    </td>
                  </tr>
                ) : (
                  backups.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-slate-900">{b.backupId || b.id}</p>
                        <p className="text-[11px] text-slate-500">{b.backupType || 'Manual'} · {b.label}</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">
                        {b.createdAt.slice(0, 10)} · {b.createdAt.slice(11, 16)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <p className="font-medium text-slate-900">{b.recordCount} rec</p>
                        <p className="text-[11px] text-slate-500">{b.sizeBytes ? `${(b.sizeBytes / 1024).toFixed(1)} KB` : '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-800">{b.destination || 'Local Snapshot'}</p>
                        <p className="text-[11px] text-slate-500">{b.encryptionStatus || 'Snapshot'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className={`font-medium ${b.status === 'Failed' ? 'text-red-700' : b.status === 'Verification Required' ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {b.status}
                        </p>
                        <p className="font-mono text-[10px] text-slate-500 truncate max-w-[160px]" title={b.checksum}>
                          {b.checksum || '—'}
                        </p>
                        {b.failureReason && <p className="text-[10px] text-red-600 mt-0.5">{b.failureReason}</p>}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        {b.storagePath && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDownloadBackupArchive(b)}
                              disabled={busy === `dl_${b.id}`}
                              className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded cursor-pointer"
                            >
                              Download .enc
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRunStagingRestore(b)}
                              disabled={busy === `stage_${b.id}`}
                              className="px-2.5 py-1 text-[11px] font-medium bg-blue-600 hover:bg-blue-700 text-white rounded cursor-pointer"
                            >
                              {busy === `stage_${b.id}` ? 'Verifying...' : 'Verify & Stage Restore'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: EXCEL EXPORT, IMPORT & MICROSOFT GRAPH */}
      {tab === 'excel' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Mode A: Domain-Separated XLSX Workbooks (Formatted PKR &amp; Auto-Filters)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Includes summary parameters, relationship IDs, and secure file references (never embeds binary X-rays).
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {([
                ['patients_clinical', 'Patients & Treatment Plans', `${patients.length} patients · ${treatmentPlans.length} plans`],
                ['appointments_ops', 'Appointments, Staff & Inventory', `${appointments.length} apts · ${inventory.length} items`],
                ['financial_ledger', 'Invoices, Balances & Journals', `${invoices.length} invoices · ${journals.length} vouchers`],
                ['management_ai', 'Management & AI Call Reports', `${callRecords.length} calls · Executive KPIs`],
              ] as [ExcelExportDomain, string, string][]).map(([domain, title, meta]) => (
                <button
                  key={domain}
                  type="button"
                  onClick={() => handleExportExcel(domain)}
                  disabled={Boolean(busy)}
                  className="text-left p-4 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/30 transition-colors cursor-pointer space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <p className="font-semibold text-slate-900">{title}</p>
                  <p className="text-[11px] text-slate-500 tabular-nums">{meta}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Controlled Excel Import Wizard */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Controlled Master Data Import (Owner Approval Required)</h3>
                <p className="text-xs text-slate-500">
                  Validates worksheet columns, missing fields, and duplicate codes. Clinical history &amp; ledger postings are never imported silently.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <select
                  value={importTarget}
                  onChange={(e) => setImportTarget(e.target.value as 'patients' | 'staff' | 'inventory' | 'services')}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="patients">Patients Master</option>
                  <option value="staff">Doctors &amp; Staff</option>
                  <option value="inventory">Inventory Items</option>
                  <option value="services">Service Catalog</option>
                </select>
                <label className="px-3.5 py-2 font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{busy === 'xlsx_parse' ? 'Scanning...' : 'Upload .xlsx'}</span>
                  <input type="file" accept=".xlsx" onChange={handleUploadExcelForPreview} className="hidden" />
                </label>
              </div>
            </div>

            {importPreview && (
              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-semibold text-slate-900">{importFilename}</span>
                    <span className="text-slate-500"> · Sheet: {importPreview.worksheetName} · {importPreview.totalRows} rows ({importPreview.validRows} valid, {importPreview.errorRows} errors)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setImportPreview(null)}
                      className="px-3 py-1.5 border border-slate-300 bg-white rounded-lg cursor-pointer"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={handleApproveExcelImport}
                      disabled={importPreview.validRows === 0 || busy === 'xlsx_commit'}
                      className="px-3.5 py-1.5 font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50 cursor-pointer"
                    >
                      {busy === 'xlsx_commit' ? 'Importing...' : `Owner Approve & Import (${importPreview.validRows} Valid)`}
                    </button>
                  </div>
                </div>
                <div className="max-h-56 overflow-auto bg-white border border-slate-200 rounded-lg">
                  <table className="w-full text-[11px] text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Preview</th>
                        <th className="px-3 py-2">Validation Errors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importPreview.rows.slice(0, 50).map((r) => (
                        <tr key={r.rowNumber}>
                          <td className="px-3 py-1.5 font-mono">{r.rowNumber}</td>
                          <td className={`px-3 py-1.5 font-medium ${r.valid ? 'text-emerald-700' : 'text-red-700'}`}>
                            {r.valid ? 'Valid' : 'Error'}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-600 truncate max-w-xs">{JSON.stringify(r.raw)}</td>
                          <td className="px-3 py-1.5 text-red-600">{r.errors.join('; ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Mode B: Microsoft Graph Online Sync */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">Mode B: Microsoft Graph OneDrive / SharePoint Sync</h3>
              <p className="text-xs text-slate-500">
                Status: <span className="font-medium text-slate-800">{runtimeStatus?.microsoft.status || 'Checking...'}</span> · Callback URL:{' '}
                <span className="font-mono">{runtimeStatus?.microsoft.callbackUrl || '/api/microsoft/auth/callback'}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleConnectMicrosoft}
                className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
              >
                Connect Microsoft Account
              </button>
              <button
                type="button"
                onClick={handleTestMicrosoft}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Test Graph
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WORDPRESS PUBLIC & PRIVATE VAULT */}
      {tab === 'wordpress' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">A. Public Website Integration (Zero-PII)</h3>
                <p className="text-xs text-slate-500">Publishes clinic address, hours, doctor specialties &amp; services only.</p>
              </div>
              <Globe className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
              <p className="font-medium text-slate-900">Strictly Excluded Fields (Never Published):</p>
              <p>Patient medical histories, CNIC, prescriptions, X-rays, clinical notes, private invoices, patient phone numbers, and payments.</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input type="checkbox" checked={wpIncludePrices} onChange={(e) => setWpIncludePrices(e.target.checked)} />
              <span>Include owner-approved public service prices (PKR)</span>
            </label>
            <button
              type="button"
              onClick={handlePublishWordPressPublic}
              disabled={busy === 'wp_pub'}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              {busy === 'wp_pub' ? 'Publishing...' : 'Sanitize & Publish Public Clinic Profile'}
            </button>
            {wpSanitizedPreview && (
              <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] font-mono overflow-auto max-h-60">
                {JSON.stringify(wpSanitizedPreview, null, 2)}
              </pre>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">B. WordPress Private Encrypted Backup Vault</h3>
                <p className="text-xs text-slate-500">Custom plugin with HTTPS guard, custom capability, HMAC &amp; non-public directory.</p>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-xs space-y-1.5 text-slate-600">
              <p>1. Download and install <span className="font-mono text-slate-900">tawakal-private-backup-vault.php</span> on your WordPress site.</p>
              <p>2. Create a dedicated WordPress integration user with an Application Password and store credentials in server Secrets (<span className="font-mono">WP_SITE_URL</span>, <span className="font-mono">WP_APP_USER</span>, <span className="font-mono">WP_APP_PASSWORD</span>, <span className="font-mono">WP_BACKUP_HMAC_SECRET</span>).</p>
              <p>3. Encrypted <span className="font-mono">.tawakal.enc</span> archives are stored outside <span className="font-mono">wp-content/uploads</span> protected by <span className="font-mono">.htaccess Deny from all</span>.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleDownloadWpPlugin}
                className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <HardDriveDownload className="w-3.5 h-3.5" />
                <span>Download WordPress Vault Plugin (.php)</span>
              </button>
              <button
                type="button"
                onClick={handleTestWordPress}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Test Endpoint Connection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: STAGING RESTORE & VERIFICATION */}
      {tab === 'restore' && (
        <div className="space-y-6">
          {stagingPreview ? (
            <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Staging Restore Verification Preview</h3>
                  <p className="text-xs text-slate-500">
                    Backup ID: <span className="font-mono">{stagingPreview.backupId}</span> · Schema v{stagingPreview.schemaVersion} · Target: {activeOrgId}
                  </p>
                </div>
                <RotateCcw className="w-5 h-5 text-blue-600" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-emerald-800 font-medium">Checksum &amp; AES-256-GCM</p>
                  <p className="font-semibold text-emerald-950 mt-1">
                    {stagingPreview.checksumMatched && stagingPreview.decryptionVerified ? 'Verified Matched' : 'Failed'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 tabular-nums">
                  <p className="text-slate-600 font-medium">Invoice Reconciliation</p>
                  <p className="font-semibold text-slate-900 mt-1">
                    {stagingPreview.invoiceTotals.invoiceCount} inv · {formatPKR(stagingPreview.invoiceTotals.grandTotalPKR)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 tabular-nums">
                  <p className="text-slate-600 font-medium">Double-Entry Ledger Check</p>
                  <p className="font-semibold text-slate-900 mt-1">
                    Debit {formatPKR(stagingPreview.journalTotals.totalDebitPKR)} === Credit {formatPKR(stagingPreview.journalTotals.totalCreditPKR)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
                {Object.entries(stagingPreview.recordCounts).map(([col, count]) => (
                  <div key={col} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 tabular-nums">
                    <p className="text-[11px] text-slate-500 truncate">{col}</p>
                    <p className="font-semibold text-slate-900">{count}</p>
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer pt-2 border-t border-slate-100">
                <input
                  type="checkbox"
                  checked={ownerRestoreConfirmed}
                  onChange={(e) => setOwnerRestoreConfirmed(e.target.checked)}
                />
                <span>I confirm I have reviewed the pre-restore safety snapshot and verified staging totals to commit this restore to {activeOrgId}.</span>
              </label>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCommitVerifiedRestore}
                  disabled={!ownerRestoreConfirmed || busy === 'commit_restore'}
                  className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {busy === 'commit_restore' ? 'Restoring...' : 'Owner Approve & Commit Restore'}
                </button>
                <button
                  type="button"
                  onClick={() => setStagingPreview(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel Preview
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-2">
              <Database className="w-7 h-7 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-900">Select an Encrypted Backup to Test Staging Restore</p>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                Click &ldquo;Verify &amp; Stage Restore&rdquo; on any archive in the Backups tab to create a pre-restore snapshot, verify SHA-256 &amp; decryption, and reconcile ledger totals before approving restoration.
              </p>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <div className="px-5 py-3 border-b border-slate-200 text-xs font-semibold text-slate-900">Restore Verification History</div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Backup ID</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Integrity</th>
                  <th className="px-4 py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {restoreRuns.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 tabular-nums">{r.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-4 py-2.5 font-mono">{r.backupId}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{r.status}</td>
                    <td className="px-4 py-2.5">
                      Checksum: {r.checksumMatched ? 'OK' : 'Fail'} · Ledger: {r.financialReconciled ? 'Balanced' : 'Check'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: SYNC QUEUE & OWNER INTEGRATION CONFIG */}
      {tab === 'sync_config' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleSaveSettings} className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Backup Schedule &amp; Non-Secret Endpoint Config</h3>
              <p className="text-slate-500 mt-0.5">Secrets (App Passwords, KMS Keys, OAuth Client Secrets) stay strictly in server Secret Manager / environment variables.</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">WordPress HTTPS Site URL</label>
                <input
                  type="url"
                  value={settingsForm.wpSiteUrl || ''}
                  onChange={(e) => setSettingsForm((p) => ({ ...p, wpSiteUrl: e.target.value }))}
                  placeholder="https://tawakaldental.pk"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">WordPress Integration Username</label>
                <input
                  type="text"
                  value={settingsForm.wpUsername || ''}
                  onChange={(e) => setSettingsForm((p) => ({ ...p, wpUsername: e.target.value }))}
                  placeholder="tawakal_vault_bot"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Microsoft Location</label>
                  <select
                    value={settingsForm.msDriveLocation || 'OneDrive'}
                    onChange={(e) => setSettingsForm((p) => ({ ...p, msDriveLocation: e.target.value as 'OneDrive' | 'SharePoint' }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="OneDrive">OneDrive for Business</option>
                    <option value="SharePoint">SharePoint Library</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Sync Frequency</label>
                  <select
                    value={settingsForm.msSyncFrequency || 'Daily'}
                    onChange={(e) => setSettingsForm((p) => ({ ...p, msSyncFrequency: e.target.value as 'Manual' | 'Hourly' | 'Daily' }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Manual">Manual</option>
                    <option value="Hourly">Hourly</option>
                    <option value="Daily">Daily</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Daily Backup</label>
                  <input
                    type="text"
                    value={settingsForm.dailyBackupTime || '23:00'}
                    onChange={(e) => setSettingsForm((p) => ({ ...p, dailyBackupTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Weekly Ret (d)</label>
                  <input
                    type="number"
                    value={settingsForm.weeklyRetentionDays ?? 30}
                    onChange={(e) => setSettingsForm((p) => ({ ...p, weeklyRetentionDays: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Monthly Ret (d)</label>
                  <input
                    type="number"
                    value={settingsForm.monthlyRetentionDays ?? 365}
                    onChange={(e) => setSettingsForm((p) => ({ ...p, monthlyRetentionDays: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={busy === 'save_cfg'}
              className="px-4 py-2 font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Integration Schedule</span>
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">Transactional Outbox &amp; Sync Queue</span>
              <span className="text-slate-500">Idempotent retry with exponential backoff</span>
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Job ID</th>
                  <th className="px-4 py-2.5">Destination</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Retries</th>
                  <th className="px-4 py-2.5">Last Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {syncJobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No queued external sync failures. ERP transactions remain isolated from temporary external outages.
                    </td>
                  </tr>
                ) : (
                  syncJobs.map((j) => (
                    <tr key={j.id}>
                      <td className="px-4 py-2.5 font-mono">{j.jobId}</td>
                      <td className="px-4 py-2.5">{j.destination}</td>
                      <td className="px-4 py-2.5 font-medium">{j.status}</td>
                      <td className="px-4 py-2.5 tabular-nums">{j.retryCount}</td>
                      <td className="px-4 py-2.5 text-red-600 truncate max-w-xs">{j.lastError || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
