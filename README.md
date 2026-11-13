# Tawakal Dental Clinic ERP

Practice Management, Clinical EHR, Double-Entry Accounting, AI Voice Receptionist, Automated Encrypted Backups, Microsoft Excel Reporting, and WordPress Integration for **Tawakal Dental Clinic** (Saudabad, Malir, Karachi, Pakistan).

---

## Architecture Overview

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4, Recharts, Lucide Icons
- **Primary Database & Auth**: Firebase Authentication & Cloud Firestore (`ai-studio-c3603411-a1d2-45a1-8480-6cef9c8f3d0d`) with strict organization-scoped Security Rules (`firestore.rules`)
- **Full-Stack Server (`server.ts`)**: Node.js 22 + Express 4 (`firebase-admin`, `@google/genai`, `exceljs`, `@google-cloud/storage`, AES-256-GCM backup vault, WordPress REST + HMAC integration, Microsoft Graph OAuth 2.0)

### Hosting Policy (Demo vs. Production)

1. **Production Clinic ERP (Required for live patient data, billing, Excel, encrypted backups, and AI routes)**:
   - Deploy the full-stack container (`Dockerfile`) on **Google Cloud Run** or **Firebase App Hosting**.
   - Store sensitive credentials (`GEMINI_API_KEY`, `BACKUP_ENCRYPTION_KEY`, `WP_APP_PASSWORD`, `WP_BACKUP_HMAC_SECRET`, `MS_CLIENT_SECRET`, `GCS_BACKUP_BUCKET`) in **Google Cloud Secret Manager**.
2. **GitHub Pages (Non-Sensitive Static Demo Only)**:
   - Serves the compiled Vite client bundle (`dist/`) for non-sensitive demo evaluation via `.github/workflows/deploy.yml`.
   - Static hosting does not run the Node.js Express backend (`/api/*`); server-side AI, `.xlsx` generation, encrypted vault backups, and OAuth routes require Cloud Run (or configuring `VITE_API_BASE_URL` + `CORS_ALLOWED_ORIGINS` against your Cloud Run backend).

---

## Local Development

```bash
npm ci
cp .env.example .env
npm run dev
```

App listens on `http://localhost:3000`.

### Quality Gates & Tests

```bash
npm run lint:rules   # ESLint verification of firestore.rules
npm run lint         # TypeScript typecheck (tsc --noEmit)
npm test             # Automated ERP, RBAC, Backup, Excel & WordPress test suite
npm run build:prod   # Builds client dist/ and Node server dist-server/server.mjs
```

---

## GitHub Actions CI/CD Workflows

1. **`.github/workflows/deploy.yml`** (GitHub Pages Demo):
   - Triggers on push to `main` or manual `workflow_dispatch`.
   - Runs `npm ci`, `npm run lint:rules`, `npm run lint`, `npm test`, and `npm run build` with automatic `VITE_BASE_PATH` detection (`/` for user/org sites, `/<repo>/` for project sites).
   - **Repository Setup**: Go to **Settings → Pages → Source** and select **GitHub Actions**.
2. **`.github/workflows/deploy-cloudrun.yml`** (Production Full-Stack Deployment):
   - Triggers on push to `main` or `workflow_dispatch`.
   - Runs all quality checks and `npm run build:prod`.
   - When repository variable `GCP_CLOUDRUN_ENABLED=true` and Workload Identity Federation secrets (`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `GCP_REGION`) are configured, builds and deploys the full-stack service to Cloud Run.

---

## WordPress & Microsoft Graph Setup

- **WordPress Private Backup Vault**: Install `wordpress-plugin/tawakal-private-backup-vault.php` on your HTTPS WordPress site, define `TAWAKAL_VAULT_HMAC_SECRET` in `wp-config.php`, and assign a dedicated non-admin service user with the `tawakal_manage_encrypted_backups` capability.
- **Microsoft Graph OAuth 2.0 Redirect URI**:
  - `https://<your-cloud-run-domain>/api/microsoft/auth/callback`

---

## Security & Rules Verification

- **Never commit** `.env`, `.clinic_vault/`, Firebase Admin private keys, or service-account JSON files.
- Always review and deploy `firestore.rules` after schema or role updates, and verify with the Firebase Emulator Suite before opening access beyond the Clinic Owner (`wrelectronicsofficial@gmail.com`).
