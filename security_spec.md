# Security Specification — Tawakal Dental Clinic ERP

## 1. Data Invariants
1. **Default-Deny Catch-All**: All Firestore paths not explicitly matched are denied by default.
2. **Verified Identity**: Every mutating operation requires `request.auth != null && request.auth.token.email_verified == true`.
3. **Role-Based Access Control (RBAC)**:
   - Bootstrapped Owner (`wrelectronicsofficial@gmail.com`) and Owner-approved staff documents in `/users/{uid}` govern role membership.
   - Users cannot self-assign `owner` or `admin` roles or switch `orgId` on their own `/users/{uid}` document.
   - Receptionists and Call Agents cannot create or finalize clinical notes, prescriptions, or odontograms (restricted to `owner`, `admin`, `dentist`).
   - Accountants cannot alter clinical records; Receptionists cannot alter accounting journal vouchers.
4. **Immutable Audit Logs & Finalized Clinical Records**:
   - `/organizations/{orgId}/audit_logs/{logId}` supports `create` and `read` by authorized staff only; `update` and `delete` are strictly forbidden (`if false`).
   - Finalized clinical notes (`isFinalized == true`) cannot be overwritten or deleted; only amendments or new notes can be appended.
5. **Financial Double-Entry Integrity**:
   - Every `/organizations/{orgId}/journals/{journalId}` document requires `totalDebit == totalCredit` and `totalDebit > 0`, and posted journals cannot be silently deleted.
6. **Path Variable Hardening**:
   - All single-document operations validate `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars) and enforce `.size()` upper bounds on strings.

## 2. The "Dirty Dozen" Adversarial Test Payloads
1. **Self-Privilege Escalation**: Non-owner user attempts to update `/users/{uid}` setting `role: "owner"`. -> **DENIED**
2. **Unverified Email Spoofing**: Request with `email_verified == false` attempts to write a patient record. -> **DENIED**
3. **Shadow Field Injection**: Create patient payload includes unexpected field `isAdminOverride: true`. -> **DENIED** (rejected by `keys().hasOnly(...)`)
4. **ID Poisoning / Buffer Overflow**: Path `/organizations/tawakal-prod/patients/../../evil` or 500-char ID. -> **DENIED** (rejected by `isValidId()`)
5. **Receptionist Clinical Tampering**: User with `role: "receptionist"` attempts to create a `clinical_notes` prescription. -> **DENIED**
6. **Silent Audit Deletion**: Even an owner attempts `delete` on `/organizations/tawakal-prod/audit_logs/{logId}`. -> **DENIED**
7. **Unbalanced Journal Voucher**: Accountant attempts to post journal with `totalDebit: 5000, totalCredit: 4000`. -> **DENIED**
8. **Cross-Organization Read**: User belonging to `tawakal-demo` attempts to read `/organizations/tawakal-prod/patients/{id}`. -> **DENIED**
9. **Deactivated Staff Access**: User with `isActive: false` in `/users/{uid}` attempts to create an appointment. -> **DENIED**
10. **Invoice Silent Deletion**: Staff attempts `delete` on a posted invoice. -> **DENIED**
11. **Oversized Payload (Denial of Wallet)**: Patient `fullName` of 5,000 characters. -> **DENIED**
12. **Blanket User Enumeration**: Non-owner attempts `list` on `/users`. -> **DENIED**
