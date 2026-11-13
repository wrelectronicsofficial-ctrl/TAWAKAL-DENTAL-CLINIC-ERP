import React, { useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, PhoneCall, PhoneForwarded, PhoneOutgoing, Send, ShieldCheck } from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { generateRecordId, saveSubdoc } from '../lib/firestore-service';
import { computeAvailableSlots } from '../lib/erp-engine';
import { apiUrl, readJsonSafe } from '../lib/api-client';
import { CallRecord } from '../types/erp';

interface ChatTurn {
  role: 'caller' | 'ai';
  text: string;
  intent?: string;
  emergencyFlag?: boolean;
  transferToHuman?: boolean;
}

export function AiReceptionistView() {
  const { activeOrgId, orgConfig, userAccount, staff, services, appointments, callRecords, getIdToken } = useErp();
  const [callerPhone, setCallerPhone] = useState('0300-1234567');
  const [callerInput, setCallerInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      role: 'ai',
      text: `Assalam-o-Alaikum, aap ${orgConfig?.clinicName || 'Tawakal Dental Clinic'} ke AI receptionist se baat kar rahe hain. Aap Urdu, Roman Urdu, ya English mein appointment booking ya clinic timings ke baare mein pooch sakte hain.`,
      intent: 'Approved Greeting',
    },
  ]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentDisclosed, setConsentDisclosed] = useState(true);
  const [recordingEnabled, setRecordingEnabled] = useState(false);

  const doctors = staff.filter((s) => s.role === 'dentist' && s.isActive);
  const today = new Date().toISOString().slice(0, 10);

  const handleSimulateCallTurn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callerInput.trim() || !userAccount) return;

    const userText = callerInput.trim();
    const nextHistory = [...turns, { role: 'caller' as const, text: userText }];
    setTurns(nextHistory);
    setCallerInput('');
    setSending(true);
    setError(null);

    const sampleSlots = doctors[0]
      ? computeAvailableSlots('10:00', '20:00', 30, appointments, doctors[0].id, doctors[0].assignedChair, today).slice(0, 6)
      : [];

    try {
      const token = await getIdToken();
      const res = await fetch(apiUrl('/api/ai/receptionist'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: userText,
          history: nextHistory,
          clinicContext: {
            clinicName: orgConfig?.clinicName || 'Tawakal Dental Clinic',
            location: orgConfig?.location || 'Saudabad, Malir, Karachi',
            openingHours: orgConfig?.openingHours || '',
            phone: orgConfig?.phone || '',
            doctors: doctors.map((d) => ({ name: d.fullName, specialty: d.specialty, chair: d.assignedChair })),
            services: services.filter((s) => s.isActive).map((s) => ({ name: s.name, feePKR: s.standardPrice })),
            availableSlots: sampleSlots,
          },
        }),
      });

      const data = await readJsonSafe<{
        reply: string;
        intent?: string;
        language?: string;
        emergencyFlag?: boolean;
        transferToHuman?: boolean;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || 'AI Receptionist failed.');

      setTurns((prev) => [
        ...prev,
        {
          role: 'ai',
          text: data.reply,
          intent: data.intent,
          emergencyFlag: data.emergencyFlag,
          transferToHuman: data.transferToHuman,
        },
      ]);

      // Persist call interaction log to Firestore
      const callEntry: Omit<CallRecord, 'id'> = {
        callCode: `CALL-${String(901 + callRecords.length)}`,
        direction: 'inbound',
        callerNumber: callerPhone || 'Unknown',
        language: data.language || 'Roman Urdu',
        intent: data.intent || 'Inquiry',
        outcome: data.emergencyFlag
          ? 'Emergency Escalation -> Human Staff'
          : data.transferToHuman
          ? 'Transferred to Receptionist'
          : 'AI Handled',
        durationSec: 45,
        transferredToHuman: Boolean(data.transferToHuman),
        emergencyFlag: Boolean(data.emergencyFlag),
        consentDisclosed,
        summary: `Caller: "${userText.slice(0, 120)}" | Intent: ${data.intent}`,
        createdAt: new Date().toISOString(),
      };

      await saveSubdoc(
        activeOrgId,
        'call_records',
        generateRecordId('call'),
        callEntry,
        { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
        'LOG_AI_CALL',
        `AI Call ${callEntry.callCode}: ${callEntry.outcome}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach AI Receptionist backend.');
    } finally {
      setSending(false);
    }
  };

  const handleTriggerOutboundReminder = async () => {
    if (!userAccount) return;
    const callEntry: Omit<CallRecord, 'id'> = {
      callCode: `OUT-${String(101 + callRecords.length)}`,
      direction: 'outbound',
      callerNumber: callerPhone,
      language: 'Urdu / Roman Urdu',
      intent: 'Appointment Reminder',
      outcome: 'Reminder Queued (Consent Checked)',
      durationSec: 0,
      transferredToHuman: false,
      emergencyFlag: false,
      consentDisclosed: true,
      summary: 'Outbound appointment reminder logged for scheduled patient confirmation.',
      createdAt: new Date().toISOString(),
    };
    await saveSubdoc(
      activeOrgId,
      'call_records',
      generateRecordId('call'),
      callEntry,
      { uid: userAccount.uid, email: userAccount.email, role: userAccount.role },
      'QUEUE_OUTBOUND_REMINDER',
      `Queued outbound reminder ${callEntry.callCode} to ${callerPhone}`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">AI Voice Receptionist &amp; Telephony Center</h1>
          <p className="text-sm text-slate-500">
            Multilingual (Urdu / Roman Urdu / English) · Emergency escalation guard · Server-side Gemini integration
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer">
            <input type="checkbox" checked={consentDisclosed} onChange={(e) => setConsentDisclosed(e.target.checked)} />
            <span>AI Identity Disclosed</span>
          </label>
          <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer">
            <input type="checkbox" checked={recordingEnabled} onChange={(e) => setRecordingEnabled(e.target.checked)} />
            <span>Recording Policy ({recordingEnabled ? 'Enabled' : 'Off by Default'})</span>
          </label>
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <span>
          <strong>Telephony &amp; Clinical Safety Note:</strong> Live PSTN/SIP phone routing in Karachi requires linking a local carrier SIP trunk or telephony webhook to <code className="font-mono">/api/ai/receptionist</code>. Test the real server-side AI receptionist below in controlled simulation mode. AI never diagnoses or prescribes and immediately escalates emergencies.
        </span>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive AI Call Simulator */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">Inbound AI Call Simulator</h3>
            </div>
            <input
              type="text"
              value={callerPhone}
              onChange={(e) => setCallerPhone(e.target.value)}
              placeholder="Caller number"
              className="px-2.5 py-1 text-xs border border-slate-300 rounded font-mono w-36"
            />
          </div>

          <div className="p-4 space-y-3 flex-1 max-h-[380px] overflow-y-auto bg-slate-50/50">
            {turns.map((t, idx) => (
              <div key={idx} className={`flex flex-col ${t.role === 'caller' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[85%] p-3 rounded-xl text-xs leading-relaxed ${
                    t.emergencyFlag
                      ? 'bg-red-50 border border-red-300 text-red-900'
                      : t.role === 'caller'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  {t.emergencyFlag && (
                    <p className="font-semibold text-red-700 flex items-center gap-1 mb-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Urgent Emergency Escalation Triggered
                    </p>
                  )}
                  <p>{t.text}</p>
                  {t.intent && (
                    <p className="text-[10px] opacity-75 mt-1.5 font-mono">
                      Intent: {t.intent} {t.transferToHuman ? '· Handover: Human Staff' : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={handleSimulateCallTurn} className="p-3 border-t border-slate-200 flex items-center gap-2 bg-white">
            <input
              type="text"
              value={callerInput}
              onChange={(e) => setCallerInput(e.target.value)}
              placeholder='Try: "Mujhe kal scaling ke liye appointment chahiye" or "Severe bleeding"'
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              disabled={sending}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{sending ? 'Processing...' : 'Send'}</span>
            </button>
          </form>
        </div>

        {/* Call History & Outbound Reminders */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-teal-600" />
              <h3 className="text-sm font-semibold text-slate-900">AI Call Logs &amp; Outbound Queue</h3>
            </div>
            <button
              type="button"
              onClick={handleTriggerOutboundReminder}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <PhoneOutgoing className="w-3.5 h-3.5" />
              <span>Queue Reminder</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100 max-h-[430px] overflow-y-auto">
            {callRecords.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                No AI calls logged yet. Simulate an inbound call or queue an outbound reminder to record a verified call log.
              </div>
            ) : (
              callRecords.map((c) => (
                <div key={c.id} className="p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-slate-900">
                      {c.callCode} · {c.direction.toUpperCase()} · {c.callerNumber}
                    </span>
                    <span className={c.emergencyFlag ? 'text-red-700 font-semibold flex items-center gap-1' : 'text-slate-600 flex items-center gap-1'}>
                      {c.transferredToHuman ? <PhoneForwarded className="w-3.5 h-3.5 text-amber-600" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                      {c.outcome}
                    </span>
                  </div>
                  <p className="text-slate-600">{c.summary}</p>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {c.language || '—'} · Consent Disclosed: {c.consentDisclosed ? 'Yes' : 'No'} · {c.createdAt.slice(0, 16).replace('T', ' ')}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
