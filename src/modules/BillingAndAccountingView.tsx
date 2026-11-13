import React, { useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, FileSpreadsheet, Plus, Printer, Receipt, Wallet } from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { generateRecordId, postJournalVoucher, saveSubdoc } from '../lib/firestore-service';
import { calculateInvoiceTotals, formatPKR, validateDoubleEntryJournal } from '../lib/erp-engine';
import { canPerformFinancialAction } from '../lib/rbac';
import { BudgetItem, Invoice, InvoiceLineItem, JournalLine, PaymentAllocation } from '../types/erp';

export function BillingAndAccountingView({ defaultTab = 'billing' }: { defaultTab?: 'billing' | 'accounting' | 'budgets' }) {
  const { activeOrgId, userAccount, orgConfig, patients, services, invoices, journals, budgets } = useErp();
  const [tab, setTab] = useState<'billing' | 'accounting' | 'budgets'>(defaultTab);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = userAccount?.role || 'receptionist';
  const canAccount = canPerformFinancialAction(role, 'approve');

  // Invoice Creation
  const [invPatientId, setInvPatientId] = useState(patients[0]?.id || '');
  const [invItemDesc, setInvItemDesc] = useState('');
  const [invItemPrice, setInvItemPrice] = useState('');
  const [invItems, setInvItems] = useState<InvoiceLineItem[]>([]);
  const [invDiscount, setInvDiscount] = useState('0');
  const [initialPayAmt, setInitialPayAmt] = useState('0');
  const [initialPayMethod, setInitialPayMethod] = useState<'Cash' | 'Bank Transfer' | 'Card' | 'Digital Wallet'>('Cash');

  // Partial payment modal
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'Cash' | 'Bank Transfer' | 'Card' | 'Digital Wallet'>('Cash');

  // Journal Voucher state
  const [voucherType, setVoucherType] = useState<'Expense' | 'Receive' | 'Payment' | 'Journal' | 'Contra'>('Expense');
  const [jCategory, setJCategory] = useState('Clinic Rent');
  const [jDesc, setJDesc] = useState('');
  const [debitAccount, setDebitAccount] = useState('5010 · Clinic Rent Expense');
  const [creditAccount, setCreditAccount] = useState('1010 · Cash in Hand');
  const [jAmount, setJAmount] = useState('');

  // Budget state
  const [budgetMonth, setBudgetMonth] = useState(new Date().toISOString().slice(0, 7));
  const [budgetCategory, setBudgetCategory] = useState('Clinic Rent');
  const [budgetPlanned, setBudgetPlanned] = useState('');

  const handleAddInvItem = () => {
    if (!invItemDesc.trim()) return;
    const price = Math.max(0, Math.round(Number(invItemPrice) || 0));
    setInvItems((prev) => [...prev, { description: invItemDesc.trim(), qty: 1, unitPrice: price, total: price }]);
    setInvItemDesc('');
    setInvItemPrice('');
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !invPatientId || invItems.length === 0) {
      setError('Select a patient and add at least one line item.');
      return;
    }
    setSaving(true);
    setError(null);

    const pat = patients.find((p) => p.id === invPatientId);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const initialAmt = Math.max(0, Math.round(Number(initialPayAmt) || 0));
    const initialPayments: PaymentAllocation[] =
      initialAmt > 0
        ? [{ id: generateRecordId('pay'), date: today, method: initialPayMethod, amount: initialAmt, receivedBy: userAccount.email }]
        : [];

    const totals = calculateInvoiceTotals(invItems, Number(invDiscount) || 0, orgConfig?.taxRatePct || 0, initialPayments);
    const invNum = `INV-${new Date().getFullYear()}-${String(invoices.length + 1).padStart(3, '0')}`;
    const actor = { uid: userAccount.uid, email: userAccount.email, role: userAccount.role };

    try {
      await saveSubdoc(
        activeOrgId,
        'invoices',
        generateRecordId('inv'),
        {
          invoiceNumber: invNum,
          patientId: invPatientId,
          patientName: pat?.fullName || 'Patient',
          itemsJson: JSON.stringify(invItems),
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          grandTotal: totals.grandTotal,
          paidAmount: totals.paidAmount,
          balanceDue: totals.balanceDue,
          status: totals.status,
          paymentsJson: JSON.stringify(initialPayments),
          createdBy: userAccount.uid,
          createdAt: now,
        },
        actor,
        'CREATE_INVOICE',
        `Issued ${invNum} for ${pat?.fullName} totaling ${formatPKR(totals.grandTotal)} (Paid: ${formatPKR(totals.paidAmount)})`
      );

      // Post balanced double-entry accounting journal if user has accounting permission
      if (canAccount && totals.grandTotal > 0) {
        const lines: JournalLine[] = [];
        if (totals.paidAmount > 0) {
          lines.push({
            accountCode: initialPayMethod === 'Cash' ? '1010' : '1020',
            accountName: initialPayMethod === 'Cash' ? 'Cash in Hand' : 'Bank Account',
            debit: totals.paidAmount,
            credit: 0,
          });
        }
        if (totals.balanceDue > 0) {
          lines.push({ accountCode: '1100', accountName: 'Patient Receivables', debit: totals.balanceDue, credit: 0 });
        }
        lines.push({ accountCode: '4010', accountName: 'Dental Services Revenue', debit: 0, credit: totals.grandTotal });

        await postJournalVoucher(
          activeOrgId,
          {
            entryNumber: `JV-${new Date().getFullYear()}-${String(journals.length + 1).padStart(3, '0')}`,
            date: today,
            voucherType: 'Receive',
            category: 'Treatment Revenue',
            description: `Invoice ${invNum} (${pat?.fullName})`,
            linesJson: JSON.stringify(lines),
            totalDebit: totals.grandTotal,
            totalCredit: totals.grandTotal,
            referenceId: invNum,
            createdBy: userAccount.uid,
            createdAt: now,
          },
          actor
        );
      }

      setInvItems([]);
      setInvDiscount('0');
      setInitialPayAmt('0');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice.');
    } finally {
      setSaving(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !payingInvoice) return;
    const amt = Math.round(Number(payAmount) || 0);
    if (amt <= 0 || amt > payingInvoice.balanceDue) {
      setError(`Payment must be between PKR 1 and ${formatPKR(payingInvoice.balanceDue)}.`);
      return;
    }

    setSaving(true);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const existingPayments: PaymentAllocation[] = payingInvoice.paymentsJson ? JSON.parse(payingInvoice.paymentsJson) : [];
    const items: InvoiceLineItem[] = payingInvoice.itemsJson ? JSON.parse(payingInvoice.itemsJson) : [];
    const nextPayments: PaymentAllocation[] = [
      ...existingPayments,
      { id: generateRecordId('pay'), date: today, method: payMethod, amount: amt, receivedBy: userAccount.email },
    ];
    const totals = calculateInvoiceTotals(items, payingInvoice.discount || 0, orgConfig?.taxRatePct || 0, nextPayments);
    const actor = { uid: userAccount.uid, email: userAccount.email, role: userAccount.role };

    try {
      await saveSubdoc(
        activeOrgId,
        'invoices',
        payingInvoice.id,
        {
          ...payingInvoice,
          paidAmount: totals.paidAmount,
          balanceDue: totals.balanceDue,
          status: totals.status,
          paymentsJson: JSON.stringify(nextPayments),
          updatedAt: new Date().toISOString(),
        },
        actor,
        'RECORD_PAYMENT',
        `Received ${formatPKR(amt)} (${payMethod}) against ${payingInvoice.invoiceNumber}`
      );

      if (canAccount) {
        const lines: JournalLine[] = [
          {
            accountCode: payMethod === 'Cash' ? '1010' : '1020',
            accountName: payMethod === 'Cash' ? 'Cash in Hand' : 'Bank Account',
            debit: amt,
            credit: 0,
          },
          { accountCode: '1100', accountName: 'Patient Receivables', debit: 0, credit: amt },
        ];
        await postJournalVoucher(
          activeOrgId,
          {
            entryNumber: `JV-${new Date().getFullYear()}-${String(journals.length + 1).padStart(3, '0')}`,
            date: today,
            voucherType: 'Receive',
            category: 'Patient Collection',
            description: `Collection against ${payingInvoice.invoiceNumber}`,
            linesJson: JSON.stringify(lines),
            totalDebit: amt,
            totalCredit: amt,
            referenceId: payingInvoice.invoiceNumber,
            createdBy: userAccount.uid,
            createdAt: new Date().toISOString(),
          },
          actor
        );
      }

      setPayingInvoice(null);
      setPayAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  };

  const handlePostJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !canAccount) return;
    const amt = Math.round(Number(jAmount) || 0);
    const [dCode, dName] = debitAccount.split(' · ');
    const [cCode, cName] = creditAccount.split(' · ');
    const lines: JournalLine[] = [
      { accountCode: dCode, accountName: dName, debit: amt, credit: 0 },
      { accountCode: cCode, accountName: cName, debit: 0, credit: amt },
    ];
    const check = validateDoubleEntryJournal(lines);
    if (!check.valid) {
      setError(check.error || 'Invalid voucher');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await postJournalVoucher(
        activeOrgId,
        {
          entryNumber: `JV-${new Date().getFullYear()}-${String(journals.length + 1).padStart(3, '0')}`,
          date: new Date().toISOString().slice(0, 10),
          voucherType,
          category: jCategory,
          description: jDesc.trim() || `${voucherType} — ${jCategory}`,
          linesJson: JSON.stringify(lines),
          totalDebit: check.totalDebit,
          totalCredit: check.totalCredit,
          createdBy: userAccount.uid,
          createdAt: new Date().toISOString(),
        },
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role }
      );
      setJDesc('');
      setJAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post voucher.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !canAccount) return;
    const planned = Math.max(0, Math.round(Number(budgetPlanned) || 0));
    setSaving(true);
    setError(null);
    try {
      const payload: Omit<BudgetItem, 'id'> = {
        month: budgetMonth,
        category: budgetCategory,
        plannedAmount: planned,
        createdAt: new Date().toISOString(),
      };
      await saveSubdoc(
        activeOrgId,
        'budgets',
        generateRecordId('bdg'),
        payload,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'SET_MONTHLY_BUDGET',
        `Set ${budgetMonth} budget for ${budgetCategory}: ${formatPKR(planned)}`
      );
      setBudgetPlanned('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save budget.');
    } finally {
      setSaving(false);
    }
  };

  const budgetComparison = useMemo(() => {
    return budgets
      .filter((b) => b.month === budgetMonth)
      .map((b) => {
        const actual = journals
          .filter((j) => j.voucherType === 'Expense' && j.date.startsWith(budgetMonth) && j.category === b.category)
          .reduce((s, j) => s + j.totalDebit, 0);
        const remaining = b.plannedAmount - actual;
        const pct = b.plannedAmount > 0 ? Math.round((actual / b.plannedAmount) * 100) : 0;
        return { ...b, actual, remaining, pct };
      });
  }, [budgets, journals, budgetMonth]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Billing, Double-Entry Ledger &amp; Budgets</h1>
          <p className="text-sm text-slate-500">PKR invoicing, partial payments, balanced journal vouchers (Debit = Credit), and monthly budgets</p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 self-start sm:self-auto">
          {([
            ['billing', 'Patient Billing'],
            ['accounting', 'General Ledger'],
            ['budgets', 'Monthly Budgets'],
          ] as const).map(([key, label]) => {
            if ((key === 'accounting' || key === 'budgets') && !canAccount) return null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                  tab === key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>}

      {tab === 'billing' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Create Invoice */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-600" />
              <span>Generate Patient Invoice</span>
            </h3>
            <form onSubmit={handleCreateInvoice} className="space-y-3 text-xs">
              <select
                required
                value={invPatientId}
                onChange={(e) => setInvPatientId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Select patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.fullName} ({p.patientCode})</option>
                ))}
              </select>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <div className="grid grid-cols-12 gap-2">
                  <select
                    value={invItemDesc}
                    onChange={(e) => {
                      const srv = services.find((s) => s.name === e.target.value);
                      setInvItemDesc(e.target.value);
                      if (srv) setInvItemPrice(String(srv.standardPrice));
                    }}
                    className="col-span-7 px-2 py-1.5 border border-slate-300 rounded bg-white"
                  >
                    <option value="">Pick configured procedure...</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  <input type="number" min={0} value={invItemPrice} onChange={(e) => setInvItemPrice(e.target.value)} placeholder="PKR" className="col-span-3 px-2 py-1.5 border border-slate-300 rounded bg-white tabular-nums" />
                  <button type="button" onClick={handleAddInvItem} className="col-span-2 bg-slate-900 text-white rounded px-2 py-1.5 cursor-pointer">
                    <Plus className="w-3.5 h-3.5 mx-auto" />
                  </button>
                </div>

                {invItems.map((it, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-white px-2.5 py-1.5 rounded border border-slate-200">
                    <span>{it.description}</span>
                    <span className="font-mono tabular-nums">{formatPKR(it.total)}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-600 mb-1">Discount</label>
                  <input type="number" min={0} value={invDiscount} onChange={(e) => setInvDiscount(e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg tabular-nums" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Initial Paid</label>
                  <input type="number" min={0} value={initialPayAmt} onChange={(e) => setInitialPayAmt(e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg tabular-nums" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Method</label>
                  <select value={initialPayMethod} onChange={(e) => setInitialPayMethod(e.target.value as 'Cash')} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white">
                    <option value="Cash">Cash</option>
                    <option value="Bank Transfer">Bank</option>
                    <option value="Card">Card</option>
                    <option value="Digital Wallet">Wallet</option>
                  </select>
                </div>
              </div>

              <button type="submit" disabled={saving || invItems.length === 0} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 cursor-pointer">
                {saving ? 'Posting Invoice...' : 'Issue Invoice'}
              </button>
            </form>
          </div>

          {/* Invoice List */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Patient Invoices &amp; Receivables</h3>
              <button type="button" onClick={() => window.print()} className="text-xs text-blue-600 flex items-center gap-1 cursor-pointer no-print">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
            </div>
            {invoices.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No invoices issued yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-4">Invoice</th>
                      <th className="py-2.5 px-4">Patient</th>
                      <th className="py-2.5 px-4 text-right">Total</th>
                      <th className="py-2.5 px-4 text-right">Paid</th>
                      <th className="py-2.5 px-4 text-right">Balance</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">
                          {inv.invoiceNumber}
                          <p className="text-[11px] text-slate-500">{inv.status}</p>
                        </td>
                        <td className="py-3 px-4 text-slate-800">{inv.patientName}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">{formatPKR(inv.grandTotal)}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">{formatPKR(inv.paidAmount)}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">{formatPKR(inv.balanceDue)}</td>
                        <td className="py-3 px-4 text-right">
                          {inv.balanceDue > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPayingInvoice(inv);
                                setPayAmount(String(inv.balanceDue));
                              }}
                              className="px-2.5 py-1 bg-blue-600 text-white rounded text-[11px] font-medium cursor-pointer"
                            >
                              Collect
                            </button>
                          ) : (
                            <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Settled
                            </span>
                          )}
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

      {tab === 'accounting' && canAccount && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-teal-600" />
              <span>Post Double-Entry Voucher</span>
            </h3>
            <form onSubmit={handlePostJournal} className="space-y-3 text-xs">
              <select value={voucherType} onChange={(e) => setVoucherType(e.target.value as 'Expense')} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="Expense">Expense Voucher</option>
                <option value="Payment">Payment Voucher</option>
                <option value="Receive">Receive Voucher</option>
                <option value="Contra">Contra (Cash/Bank)</option>
                <option value="Journal">Journal Voucher</option>
              </select>
              <select value={jCategory} onChange={(e) => setJCategory(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="Clinic Rent">Clinic Rent</option>
                <option value="Staff Salaries">Staff Salaries</option>
                <option value="Electricity">Electricity</option>
                <option value="Dental Materials">Dental Materials</option>
                <option value="Laboratory Charges">Laboratory Charges</option>
                <option value="Marketing">Marketing</option>
                <option value="Equipment Maintenance">Equipment Maintenance</option>
                <option value="Other">Other</option>
              </select>
              <div>
                <label className="block text-slate-600 mb-1">Debit Account (Dr)</label>
                <select value={debitAccount} onChange={(e) => setDebitAccount(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="5010 · Clinic Rent Expense">5010 · Clinic Rent Expense</option>
                  <option value="5020 · Salaries & Compensation">5020 · Salaries &amp; Compensation</option>
                  <option value="5030 · Utilities & Electricity">5030 · Utilities &amp; Electricity</option>
                  <option value="5040 · Dental Materials Expense">5040 · Dental Materials Expense</option>
                  <option value="1020 · Bank Account">1020 · Bank Account</option>
                  <option value="1010 · Cash in Hand">1010 · Cash in Hand</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Credit Account (Cr)</label>
                <select value={creditAccount} onChange={(e) => setCreditAccount(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="1010 · Cash in Hand">1010 · Cash in Hand</option>
                  <option value="1020 · Bank Account">1020 · Bank Account</option>
                  <option value="2010 · Supplier Payables">2010 · Supplier Payables</option>
                  <option value="4010 · Dental Services Revenue">4010 · Dental Services Revenue</option>
                </select>
              </div>
              <input type="number" min={1} required value={jAmount} onChange={(e) => setJAmount(e.target.value)} placeholder="Amount (PKR)" className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
              <input value={jDesc} onChange={(e) => setJDesc(e.target.value)} placeholder="Voucher Narration" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              <button type="submit" disabled={saving} className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg cursor-pointer">
                Post Balanced Voucher
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">General Ledger Journals (Debit = Credit Verified)</h3>
              <span className="text-xs text-slate-500 tabular-nums">{journals.length} vouchers</span>
            </div>
            {journals.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No accounting vouchers posted yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-4">Voucher</th>
                      <th className="py-2.5 px-4">Type / Category</th>
                      <th className="py-2.5 px-4">Narration</th>
                      <th className="py-2.5 px-4 text-right">Debit</th>
                      <th className="py-2.5 px-4 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {journals.map((j) => (
                      <tr key={j.id}>
                        <td className="py-3 px-4 font-mono">
                          <p className="font-medium text-slate-900">{j.entryNumber}</p>
                          <p className="text-[11px] text-slate-500">{j.date}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{j.voucherType}</p>
                          <p className="text-[11px] text-slate-500">{j.category}</p>
                        </td>
                        <td className="py-3 px-4 text-slate-700">{j.description}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">{formatPKR(j.totalDebit)}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">{formatPKR(j.totalCredit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'budgets' && canAccount && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-blue-600" />
              <span>Assign Monthly Budget</span>
            </h3>
            <form onSubmit={handleSaveBudget} className="space-y-3 text-xs">
              <input type="month" value={budgetMonth} onChange={(e) => setBudgetMonth(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
              <select value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="Clinic Rent">Clinic Rent</option>
                <option value="Staff Salaries">Staff Salaries</option>
                <option value="Electricity">Electricity</option>
                <option value="Dental Materials">Dental Materials</option>
                <option value="Marketing">Marketing</option>
              </select>
              <input type="number" min={0} required value={budgetPlanned} onChange={(e) => setBudgetPlanned(e.target.value)} placeholder="Planned Budget (PKR)" className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
              <button type="submit" disabled={saving} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer">
                Save Budget Allocation
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Budget vs Actual Spending ({budgetMonth})</h3>
            {budgetComparison.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">No budget targets configured for {budgetMonth}.</p>
            ) : (
              <div className="space-y-3">
                {budgetComparison.map((b) => (
                  <div key={b.id} className="p-3.5 rounded-lg border border-slate-200 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{b.category}</span>
                      <span className="font-mono tabular-nums text-slate-700">
                        Actual {formatPKR(b.actual)} / Planned {formatPKR(b.plannedAmount)} ({b.pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full ${b.pct > 100 ? 'bg-red-600' : 'bg-blue-600'}`}
                        style={{ width: `${Math.min(100, b.pct)}%` }}
                      />
                    </div>
                    <p className={`text-[11px] font-medium ${b.remaining < 0 ? 'text-red-700' : 'text-slate-500'}`}>
                      {b.remaining < 0 ? `Over budget by ${formatPKR(Math.abs(b.remaining))}` : `Remaining: ${formatPKR(b.remaining)}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collect Partial Payment Modal */}
      {payingInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <h3 className="text-base font-semibold text-slate-900">Record Payment · {payingInvoice.invoiceNumber}</h3>
            </div>
            <p className="text-xs text-slate-600">
              Patient: {payingInvoice.patientName} · Remaining Balance: <strong className="font-mono">{formatPKR(payingInvoice.balanceDue)}</strong>
            </p>
            <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
              <input type="number" min={1} max={payingInvoice.balanceDue} required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'Cash')} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Card">Card</option>
                <option value="Digital Wallet">Digital Wallet (JazzCash / Easypaisa)</option>
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setPayingInvoice(null)} className="px-4 py-2 border border-slate-300 rounded-lg cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium cursor-pointer">Confirm Payment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
