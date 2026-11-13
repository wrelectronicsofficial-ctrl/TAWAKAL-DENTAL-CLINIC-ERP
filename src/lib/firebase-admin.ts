import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { UserRole } from '../types/erp';

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export const adminAuth = getAuth();
export const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId);

export async function resolveVerifiedRole(
  uid: string,
  email?: string,
  emailVerified?: boolean,
  claimedRole?: UserRole
): Promise<UserRole> {
  if (emailVerified && email?.toLowerCase() === 'wrelectronicsofficial@gmail.com') {
    return 'owner';
  }
  try {
    const snap = await adminDb.doc(`users/${uid}`).get();
    if (snap.exists) {
      const data = snap.data();
      if (data?.isActive === false) {
        throw new Error('User account is deactivated.');
      }
      if (typeof data?.role === 'string') {
        return data.role as UserRole;
      }
    }
  } catch (err) {
    // Fallback only if ADC is unavailable in local dev preview; never elevate to owner/admin blindly
    if (claimedRole && !['owner', 'admin'].includes(claimedRole)) {
      return claimedRole;
    }
    if (err instanceof Error && err.message.includes('deactivated')) {
      throw err;
    }
  }
  return 'receptionist';
}
