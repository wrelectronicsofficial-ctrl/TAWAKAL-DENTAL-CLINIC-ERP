import React, { useState } from 'react';
import { ShieldCheck, Lock, Mail, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useErp } from '../context/ErpContext';

export function LoginScreen() {
  const { signInGoogle, signInEmail, resetPassword, authError } = useErp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    try {
      await signInEmail(email, password);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (!email) return;
    setSubmitting(true);
    try {
      await resetPassword(email);
      setResetSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 shadow-sm">
        {/* Left Clinical Identity Panel */}
        <div className="lg:col-span-5 bg-slate-900 text-white p-8 sm:p-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-10">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-white">Tawakal Dental Clinic</h1>
                <p className="text-xs text-slate-400">Saudabad, Malir, Karachi · ERP &amp; Clinical EHR</p>
              </div>
            </div>

            <h2 className="text-3xl font-semibold tracking-tight leading-tight text-white mb-4" style={{ textWrap: 'balance' }}>
              Clinical care, scheduling, accounting &amp; AI reception in one place.
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Role-isolated access for clinic owners, dentists, front-desk receptionists, accountants, and inventory controllers.
            </p>
          </div>

          <div className="mt-10 pt-6 border-t border-slate-800 grid grid-cols-3 gap-4 text-left">
            <div>
              <p className="text-sm font-semibold text-white">RBAC</p>
              <p className="text-xs text-slate-400">9 staff roles</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">ISO 3950</p>
              <p className="text-xs text-slate-400">Digital charting</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Audit Trail</p>
              <p className="text-xs text-slate-400">Immutable logs</p>
            </div>
          </div>
        </div>

        {/* Right Authentication Form */}
        <div className="lg:col-span-7 p-8 sm:p-12 flex flex-col justify-center">
          <div className="max-w-md w-full mx-auto">
            <h2 className="text-2xl font-semibold text-slate-900 tracking-tight mb-1">Sign in to workspace</h2>
            <p className="text-sm text-slate-500 mb-6">
              Use your authorized clinic Google account or staff credentials. Public registration is disabled.
            </p>

            {authError && (
              <div className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                <span>{authError}</span>
              </div>
            )}

            {resetSent && (
              <div className="mb-5 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-sm text-emerald-800">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                <span>Password reset link sent to {email}.</span>
              </div>
            )}

            <button
              type="button"
              onClick={signInGoogle}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>Continue with Authorized Google Account</span>
            </button>

            <div className="my-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs text-slate-400 font-medium">OR STAFF EMAIL &amp; PASSWORD</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Work Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="doctor@tawakaldental.pk"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-700">Password</label>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors cursor-pointer"
              >
                {submitting ? 'Signing in...' : 'Sign In with Email'}
              </button>
            </form>

            <p className="mt-6 text-xs text-slate-500 leading-relaxed">
              Note: Email/Password accounts require enabling the Email/Password sign-in provider in Firebase Console Authentication settings. Google Sign-In works immediately for authorized clinic staff.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
