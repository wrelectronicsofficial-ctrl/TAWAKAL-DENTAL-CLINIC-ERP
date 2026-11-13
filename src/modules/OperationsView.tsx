import React, { useState } from 'react';
import { BookOpen, CheckCircle2, Package, Plus, ShieldAlert, UserCheck } from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { generateRecordId, saveSubdoc } from '../lib/firestore-service';
import { applyInventoryMovement, formatPKR } from '../lib/erp-engine';
import { InventoryItem, ServiceCatalogItem, StaffMember, SterilizationLog, UserRole } from '../types/erp';

export function OperationsView({ defaultTab = 'inventory' }: { defaultTab?: 'inventory' | 'sterilization' | 'doctors' | 'services' }) {
  const { activeOrgId, userAccount, inventory, sterilizationLogs, staff, services } = useErp();
  const [tab, setTab] = useState<'inventory' | 'sterilization' | 'doctors' | 'services'>(defaultTab);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inventory form
  const [invSku, setInvSku] = useState('');
  const [invName, setInvName] = useState('');
  const [invCat, setInvCat] = useState('Consumables');
  const [invUnit, setInvUnit] = useState('Box');
  const [invStock, setInvStock] = useState('0');
  const [invMin, setInvMin] = useState('10');
  const [invExpiry, setInvExpiry] = useState('');
  const [invSupplier, setInvSupplier] = useState('');

  // Sterilization form
  const [strSet, setStrSet] = useState('');
  const [strEq, setStrEq] = useState('Autoclave Unit 1');
  const [strResult, setStrResult] = useState<'Pass' | 'Fail' | 'Pending'>('Pass');
  const [strStaff, setStrStaff] = useState('');

  // Staff / Doctor form
  const [docName, setDocName] = useState('');
  const [docRole, setDocRole] = useState<UserRole>('dentist');
  const [docSpec, setDocSpec] = useState('');
  const [docPmdc, setDocPmdc] = useState('');
  const [docVerifyStatus, setDocVerifyStatus] = useState<'unverified' | 'pending' | 'verified'>('unverified');
  const [docFee, setDocFee] = useState('');
  const [docChair, setDocChair] = useState('Chair 1');
  const [docPhone, setDocPhone] = useState('');

  // Service form
  const [srvCode, setSrvCode] = useState('');
  const [srvName, setSrvName] = useState('');
  const [srvCat, setSrvCat] = useState('General');
  const [srvPrice, setSrvPrice] = useState('');
  const [srvDuration, setSrvDuration] = useState('30');

  const handleAddInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !invName.trim()) return;
    setSaving(true);
    setError(null);
    const payload: Omit<InventoryItem, 'id'> = {
      sku: invSku.trim() || `SKU-${Date.now().toString().slice(-4)}`,
      name: invName.trim(),
      category: invCat,
      unit: invUnit,
      currentStock: Math.max(0, Number(invStock) || 0),
      minStock: Math.max(0, Number(invMin) || 0),
      expiryDate: invExpiry || undefined,
      supplierName: invSupplier.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveSubdoc(
        activeOrgId,
        'inventory',
        generateRecordId('itm'),
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'ADD_INVENTORY_ITEM',
        `Added inventory item ${payload.name} (${payload.currentStock} ${payload.unit})`
      );
      setInvSku('');
      setInvName('');
      setInvStock('0');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save inventory item.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdjustStock = async (item: InventoryItem, delta: number) => {
    if (!userAccount) return;
    setError(null);
    try {
      const nextStock = applyInventoryMovement(item.currentStock, delta);
      await saveSubdoc(
        activeOrgId,
        'inventory',
        item.id,
        { ...item, currentStock: nextStock, updatedAt: new Date().toISOString() },
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'ADJUST_INVENTORY_STOCK',
        `${delta > 0 ? 'Stock In' : 'Approved Usage'} ${item.name}: ${item.currentStock} → ${nextStock}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust stock.');
    }
  };

  const handleAddSterilization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !strSet.trim()) return;
    setSaving(true);
    setError(null);
    const now = new Date();
    const payload: Omit<SterilizationLog, 'id'> = {
      batchId: `AUT-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${String(sterilizationLogs.length + 1)}`,
      instrumentSet: strSet.trim(),
      equipmentName: strEq.trim(),
      cycleDate: now.toISOString().slice(0, 10),
      cycleTime: now.toTimeString().slice(0, 5),
      indicatorResult: strResult,
      responsibleStaff: strStaff.trim() || userAccount.displayName,
      createdAt: now.toISOString(),
    };
    try {
      await saveSubdoc(
        activeOrgId,
        'sterilization_logs',
        generateRecordId('str'),
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'LOG_STERILIZATION_CYCLE',
        `Logged autoclave cycle ${payload.batchId} (${payload.indicatorResult})`
      );
      setStrSet('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sterilization log.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !docName.trim()) return;
    setSaving(true);
    setError(null);
    const payload: Omit<StaffMember, 'id'> = {
      staffCode: `${docRole === 'dentist' ? 'DR' : 'STF'}-${String(staff.length + 1).padStart(3, '0')}`,
      fullName: docName.trim(),
      role: docRole,
      specialty: docSpec.trim() || undefined,
      pmdcNumber: docPmdc.trim() || undefined,
      credentialStatus: docVerifyStatus,
      consultationFee: docFee ? Math.max(0, Math.round(Number(docFee))) : undefined,
      assignedChair: docChair,
      phone: docPhone.trim() || undefined,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    try {
      await saveSubdoc(
        activeOrgId,
        'staff',
        generateRecordId('stf'),
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'ADD_CLINIC_STAFF',
        `Added ${payload.role} ${payload.fullName} (PMDC verification: ${payload.credentialStatus})`
      );
      setDocName('');
      setDocSpec('');
      setDocPmdc('');
      setDocFee('');
      setDocPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add staff member.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !srvName.trim()) return;
    setSaving(true);
    setError(null);
    const payload: Omit<ServiceCatalogItem, 'id'> = {
      code: srvCode.trim() || `SRV-${String(services.length + 1).padStart(3, '0')}`,
      name: srvName.trim(),
      category: srvCat,
      standardPrice: Math.max(0, Math.round(Number(srvPrice) || 0)),
      durationMin: Math.max(10, Math.round(Number(srvDuration) || 30)),
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    try {
      await saveSubdoc(
        activeOrgId,
        'services',
        generateRecordId('srv'),
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'ADD_SERVICE_CATALOG',
        `Configured service ${payload.name} at ${formatPKR(payload.standardPrice)}`
      );
      setSrvCode('');
      setSrvName('');
      setSrvPrice('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add service.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Clinic Operations, Inventory &amp; Team</h1>
          <p className="text-sm text-slate-500">Dental materials batch/expiry control, sterilization register, doctors, and fee schedule</p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 overflow-x-auto">
          {([
            ['inventory', 'Inventory'],
            ['sterilization', 'Sterilization'],
            ['doctors', 'Doctors & Staff'],
            ['services', 'Service Catalog'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                tab === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>}

      {tab === 'inventory' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              <span>Register Dental Material</span>
            </h3>
            <form onSubmit={handleAddInventory} className="space-y-3 text-xs">
              <input required value={invName} onChange={(e) => setInvName(e.target.value)} placeholder="Item Name *" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <div className="grid grid-cols-2 gap-2">
                <input value={invSku} onChange={(e) => setInvSku(e.target.value)} placeholder="SKU" className="px-3 py-2 border border-slate-300 rounded-lg" />
                <select value={invCat} onChange={(e) => setInvCat(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="Consumables">Consumables</option>
                  <option value="Gloves">Gloves</option>
                  <option value="RCT Materials">RCT Materials</option>
                  <option value="Restorative Materials">Restorative</option>
                  <option value="Sterilization Supplies">Sterilization</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" min={0} value={invStock} onChange={(e) => setInvStock(e.target.value)} placeholder="Qty" className="px-2.5 py-2 border border-slate-300 rounded-lg tabular-nums" />
                <input type="number" min={0} value={invMin} onChange={(e) => setInvMin(e.target.value)} placeholder="Min" className="px-2.5 py-2 border border-slate-300 rounded-lg tabular-nums" />
                <input value={invUnit} onChange={(e) => setInvUnit(e.target.value)} placeholder="Unit" className="px-2.5 py-2 border border-slate-300 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={invExpiry} onChange={(e) => setInvExpiry(e.target.value)} className="px-2.5 py-2 border border-slate-300 rounded-lg tabular-nums" />
                <input value={invSupplier} onChange={(e) => setInvSupplier(e.target.value)} placeholder="Supplier" className="px-2.5 py-2 border border-slate-300 rounded-lg" />
              </div>
              <button type="submit" disabled={saving} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer">
                Add Stock Item
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Dental Stock &amp; Batch Control</h3>
              <span className="text-xs text-slate-500">{inventory.length} items</span>
            </div>
            {inventory.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No dental materials tracked yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-4">Item / SKU</th>
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-4 text-right">Stock</th>
                      <th className="py-2.5 px-4">Expiry</th>
                      <th className="py-2.5 px-4 text-right">Adjust</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventory.map((item) => {
                      const low = item.currentStock <= item.minStock;
                      return (
                        <tr key={item.id}>
                          <td className="py-3 px-4">
                            <p className="font-medium text-slate-900">{item.name}</p>
                            <p className="text-[11px] font-mono text-slate-500">{item.sku}</p>
                          </td>
                          <td className="py-3 px-4 text-slate-600">{item.category}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            <span className={low ? 'text-red-700 font-semibold' : 'text-slate-900'}>
                              {item.currentStock} {item.unit}
                            </span>
                            {low && <p className="text-[10px] text-red-600">Below min ({item.minStock})</p>}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-600">{item.expiryDate || '—'}</td>
                          <td className="py-3 px-4 text-right space-x-1">
                            <button type="button" onClick={() => handleAdjustStock(item, 5)} className="px-2 py-1 border border-slate-300 rounded hover:bg-slate-100 cursor-pointer">+5</button>
                            <button type="button" onClick={() => handleAdjustStock(item, -1)} className="px-2 py-1 border border-slate-300 rounded hover:bg-slate-100 cursor-pointer">-1</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'sterilization' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-teal-600" />
              <span>Log Autoclave Sterilization Cycle</span>
            </h3>
            <form onSubmit={handleAddSterilization} className="space-y-3 text-xs">
              <input required value={strSet} onChange={(e) => setStrSet(e.target.value)} placeholder="Instrument Set (e.g. Scaling Tray #2)" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <input required value={strEq} onChange={(e) => setStrEq(e.target.value)} placeholder="Autoclave Unit" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <select value={strResult} onChange={(e) => setStrResult(e.target.value as 'Pass')} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="Pass">Indicator Result: Pass</option>
                <option value="Fail">Indicator Result: Fail</option>
                <option value="Pending">Pending Verification</option>
              </select>
              <input value={strStaff} onChange={(e) => setStrStaff(e.target.value)} placeholder="Responsible Staff Member" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <button type="submit" disabled={saving} className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg cursor-pointer">
                Record Sterilization Cycle
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Infection Control &amp; Autoclave Register</h3>
            </div>
            {sterilizationLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No sterilization cycles logged yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-4">Batch ID</th>
                      <th className="py-2.5 px-4">Instrument Set</th>
                      <th className="py-2.5 px-4">Date / Staff</th>
                      <th className="py-2.5 px-4 text-right">Indicator</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sterilizationLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">{log.batchId}</td>
                        <td className="py-3 px-4 text-slate-800">{log.instrumentSet} · {log.equipmentName}</td>
                        <td className="py-3 px-4 text-slate-600">{log.cycleDate} {log.cycleTime} · {log.responsibleStaff}</td>
                        <td className="py-3 px-4 text-right font-semibold">
                          <span className={log.indicatorResult === 'Pass' ? 'text-emerald-700' : 'text-red-700'}>
                            {log.indicatorResult}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'doctors' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-600" />
              <span>Add Dentist or Clinic Staff</span>
            </h3>
            <form onSubmit={handleAddStaff} className="space-y-3 text-xs">
              <input required value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Full Name (e.g. Dr. ...) *" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <select value={docRole} onChange={(e) => setDocRole(e.target.value as UserRole)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="dentist">Dentist</option>
                <option value="assistant">Dental Assistant</option>
                <option value="receptionist">Receptionist</option>
                <option value="manager">Clinic Manager</option>
                <option value="accountant">Accountant</option>
                <option value="inventory_manager">Inventory Manager</option>
                <option value="call_agent">Call Centre Agent</option>
              </select>
              <input value={docSpec} onChange={(e) => setDocSpec(e.target.value)} placeholder="Specialty / Designation" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <div className="grid grid-cols-2 gap-2">
                <input value={docPmdc} onChange={(e) => setDocPmdc(e.target.value)} placeholder="PMDC Reg #" className="px-3 py-2 border border-slate-300 rounded-lg" />
                <select value={docVerifyStatus} onChange={(e) => setDocVerifyStatus(e.target.value as 'unverified')} className="px-2 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="unverified">PMDC Unverified</option>
                  <option value="pending">PMDC Pending</option>
                  <option value="verified">Manually Verified</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min={0} value={docFee} onChange={(e) => setDocFee(e.target.value)} placeholder="Consult Fee (PKR)" className="px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
                <input value={docChair} onChange={(e) => setDocChair(e.target.value)} placeholder="Chair (e.g. Chair 1)" className="px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <input value={docPhone} onChange={(e) => setDocPhone(e.target.value)} placeholder="Contact Mobile" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <button type="submit" disabled={saving} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer">
                Save Staff Profile
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Doctors &amp; Staff Directory</h3>
            </div>
            {staff.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No doctors or staff configured yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-4">Staff / Code</th>
                      <th className="py-2.5 px-4">Role &amp; Specialty</th>
                      <th className="py-2.5 px-4">PMDC Verification</th>
                      <th className="py-2.5 px-4 text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {staff.map((s) => (
                      <tr key={s.id}>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{s.fullName}</p>
                          <p className="text-[11px] font-mono text-slate-500">{s.staffCode} · {s.assignedChair || '—'}</p>
                        </td>
                        <td className="py-3 px-4 capitalize text-slate-700">{s.role} · {s.specialty || 'General'}</td>
                        <td className="py-3 px-4 text-slate-700">
                          {s.pmdcNumber || '—'} · <span className="capitalize font-medium">{s.credentialStatus || 'unverified'}</span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {s.consultationFee ? formatPKR(s.consultationFee) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'services' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              <span>Configure Dental Procedure</span>
            </h3>
            <form onSubmit={handleAddService} className="space-y-3 text-xs">
              <input required value={srvName} onChange={(e) => setSrvName(e.target.value)} placeholder="Service Name *" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <div className="grid grid-cols-2 gap-2">
                <input value={srvCode} onChange={(e) => setSrvCode(e.target.value)} placeholder="Code (e.g. SRV-FIL)" className="px-3 py-2 border border-slate-300 rounded-lg" />
                <input value={srvCat} onChange={(e) => setSrvCat(e.target.value)} placeholder="Category" className="px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min={0} required value={srvPrice} onChange={(e) => setSrvPrice(e.target.value)} placeholder="Standard Fee (PKR)" className="px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
                <input type="number" min={10} step={5} value={srvDuration} onChange={(e) => setSrvDuration(e.target.value)} placeholder="Mins" className="px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
              </div>
              <button type="submit" disabled={saving} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center justify-center gap-1.5 cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
                <span>Add to Catalog</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Active Clinic Service Catalog</h3>
            </div>
            {services.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No services configured yet. Run the Owner Setup Wizard or add services here.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-4">Code</th>
                      <th className="py-2.5 px-4">Service Name</th>
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-4 text-right">Duration</th>
                      <th className="py-2.5 px-4 text-right">Fee (PKR)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {services.map((s) => (
                      <tr key={s.id}>
                        <td className="py-3 px-4 font-mono text-slate-600">{s.code}</td>
                        <td className="py-3 px-4 font-medium text-slate-900 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{s.name}</span>
                        </td>
                        <td className="py-3 px-4 text-slate-600">{s.category}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">{s.durationMin} min</td>
                        <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-slate-900">{formatPKR(s.standardPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
