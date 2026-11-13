import React, { useState } from 'react';
import { Building2, Check, X } from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { generateRecordId, saveSubdoc, updateOrganizationConfig } from '../lib/firestore-service';

interface ServiceDraft {
  code: string;
  name: string;
  category: string;
  enabled: boolean;
  price: string;
  duration: string;
}

export function SetupWizardModal({ onClose }: { onClose: () => void }) {
  const { activeOrgId, orgConfig, userAccount } = useErp();
  const [openingHours, setOpeningHours] = useState(orgConfig?.openingHours || '');
  const [phone, setPhone] = useState(orgConfig?.phone || '');
  const [chairsCount, setChairsCount] = useState(String(orgConfig?.chairsCount || 2));
  const [slotMinutes, setSlotMinutes] = useState(String(orgConfig?.defaultSlotMinutes || 30));
  const [shccNo, setShccNo] = useState(orgConfig?.shccRegistrationNo || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [initialServices, setInitialServices] = useState<ServiceDraft[]>([
    { code: 'SRV-CON', name: 'Initial Dental Consultation', category: 'Consultation', enabled: true, price: '', duration: '30' },
    { code: 'SRV-SCL', name: 'Dental Scaling', category: 'Scaling', enabled: true, price: '', duration: '45' },
    { code: 'SRV-RCT', name: 'Root Canal Treatment (RCT)', category: 'RCT', enabled: true, price: '', duration: '60' },
    { code: 'SRV-EXT', name: 'Tooth Extraction', category: 'Extraction', enabled: true, price: '', duration: '30' },
    { code: 'SRV-CRN', name: 'Dental Crowns', category: 'Crowns', enabled: true, price: '', duration: '45' },
  ]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    if (!openingHours.trim()) {
      setError('Please enter the clinic’s actual verified opening hours.');
      return;
    }
    const chairs = Number(chairsCount);
    if (!Number.isInteger(chairs) || chairs < 1) {
      setError('Number of dental chairs / operatories must be at least 1.');
      return;
    }

    for (const s of initialServices.filter((x) => x.enabled)) {
      if (s.price === '' || Number(s.price) < 0) {
        setError(`Please enter a valid PKR fee (0 or greater) for "${s.name}" — no prices are guessed automatically.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    const actor = { uid: userAccount.uid, email: userAccount.email, role: userAccount.role };

    try {
      await updateOrganizationConfig(activeOrgId, actor, {
        openingHours: openingHours.trim(),
        phone: phone.trim(),
        chairsCount: chairs,
        defaultSlotMinutes: Number(slotMinutes) || 30,
        shccRegistrationNo: shccNo.trim(),
        setupCompleted: true,
      });

      const now = new Date().toISOString();
      for (const s of initialServices) {
        if (!s.enabled) continue;
        await saveSubdoc(
          activeOrgId,
          'services',
          generateRecordId('srv'),
          {
            code: s.code,
            name: s.name,
            category: s.category,
            standardPrice: Math.round(Number(s.price)),
            durationMin: Math.max(10, Math.round(Number(s.duration) || 30)),
            labCost: 0,
            materialCost: 0,
            isActive: true,
            createdAt: now,
          },
          actor,
          'CONFIGURE_INITIAL_SERVICE',
          `Configured initial service ${s.name} at PKR ${s.price}`
        );
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save setup configuration.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl shadow-lg overflow-hidden my-8">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">Tawakal Dental Clinic — Owner Setup Wizard</h3>
              <p className="text-xs text-slate-500">Saudabad, Malir, Karachi · Configure actual verified clinic parameters</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Verified Opening Hours *</label>
              <input
                type="text"
                required
                value={openingHours}
                onChange={(e) => setOpeningHours(e.target.value)}
                placeholder="e.g. Mon-Sat 11:00 - 22:00"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Verified Clinic Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Owner-verified clinic line"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Dental Chairs / Operatories *</label>
              <input
                type="number"
                min={1}
                max={20}
                required
                value={chairsCount}
                onChange={(e) => setChairsCount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">SHCC Registration No. (Optional)</label>
              <input
                type="text"
                value={shccNo}
                onChange={(e) => setShccNo(e.target.value)}
                placeholder="Sindh Healthcare Commission Reg #"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Default Appointment Slot (Minutes)</label>
              <select
                value={slotMinutes}
                onChange={(e) => setSlotMinutes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="15">15 minutes</option>
                <option value="20">20 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200">
            <h4 className="text-sm font-semibold text-slate-900 mb-1">Initial Services &amp; Owner-Confirmed PKR Fees</h4>
            <p className="text-xs text-slate-500 mb-3">
              Enter your clinic&apos;s actual PKR fees for the services you offer. Uncheck any service not currently active.
            </p>
            <div className="space-y-2.5">
              {initialServices.map((srv, idx) => (
                <div key={srv.code} className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                  <label className="col-span-5 flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={srv.enabled}
                      onChange={(e) => {
                        const copy = [...initialServices];
                        copy[idx].enabled = e.target.checked;
                        setInitialServices(copy);
                      }}
                      className="rounded border-slate-300"
                    />
                    <span className="truncate">{srv.name}</span>
                  </label>
                  <div className="col-span-4">
                    <input
                      type="number"
                      min={0}
                      disabled={!srv.enabled}
                      value={srv.price}
                      onChange={(e) => {
                        const copy = [...initialServices];
                        copy[idx].price = e.target.value;
                        setInitialServices(copy);
                      }}
                      placeholder="Fee (PKR)"
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white disabled:bg-slate-100 tabular-nums"
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="number"
                      min={10}
                      step={5}
                      disabled={!srv.enabled}
                      value={srv.duration}
                      onChange={(e) => {
                        const copy = [...initialServices];
                        copy[idx].duration = e.target.value;
                        setInitialServices(copy);
                      }}
                      placeholder="Mins"
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white disabled:bg-slate-100 tabular-nums"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving Configuration...' : 'Save & Complete Setup'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
