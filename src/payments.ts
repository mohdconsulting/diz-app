import { esc, toast } from './util';
import { t, sb, sbRef, payments, setPayments, paymentsMode, setPaymentsMode, currentUser, role, dbRef } from './state';
import { refreshCurrentScreen } from './shell';
import type { Job, Payment, PaymentStatus, PaymentsMode } from './types';

/*
 * Payments (escrow).  The database (diz_payments.sql) is the source of truth; this module only
 *   - reads `payments` / `app_settings`,
 *   - asks the database to create a payment (rpc create_payment),
 *   - hands the customer over to a PAYMENT PROVIDER that actually collects the money.
 *
 * Providers are interchangeable. To go live with Qi Card, only the `liveProvider` below and the two server
 * functions in supabase/functions/ (create the payment at Qi, receive Qi's webhook) need real Qi calls.
 * Nothing else in the app changes: the webhook calls confirm_payment() and the UI updates through realtime.
 */

export interface PaymentProvider {
  /** The payment row exists (status 'pending'); now collect the money. Resolves when the customer was handed over. */
  begin(p: Payment): Promise<void>;
}

/** The payment whose fake checkout panel is open (mock provider only). */
export let mockCheckoutId: string | null = null;
export function setMockCheckoutId(v: string | null){ mockCheckoutId = v; }

/** Test provider: shows an in-app "checkout" with Pay / Fail buttons. No money moves. */
const mockProvider: PaymentProvider = {
  async begin(p){ setMockCheckoutId(p.id); refreshCurrentScreen(); },
};

/**
 * Real provider (Qi Card or similar). The Edge Function `start-checkout` talks to the provider with secret keys
 * (never in the browser), stores psp_ref/checkout_url on the payment and returns the hosted payment page URL.
 */
const liveProvider: PaymentProvider = {
  async begin(p){
    const { data, error } = await sb().functions.invoke('start-checkout', { body: { paymentId: p.id } });
    const url = data && (data as { url?: string }).url;
    if(error || !url) throw new Error(error ? error.message : 'no checkout url');
    toast(t().pay.redirecting);
    window.location.href = url;
  },
};

export function providerFor(mode: PaymentsMode): PaymentProvider | null {
  return mode === 'mock' ? mockProvider : mode === 'live' ? liveProvider : null;
}

// ---------- data ----------
type Row = Record<string, unknown>;
function rowToPayment(r: Row): Payment {
  return {
    id: r.id as string, jobId: r.job_id as string, customerPhone: r.customer_phone as string,
    providerPhone: r.provider_phone as string, amount: r.amount as number, commission: r.commission as number,
    payoutAmount: r.payout_amount as number, currency: (r.currency as string) || 'IQD', psp: r.psp as 'mock' | 'qi',
    pspRef: (r.psp_ref as string) ?? null, checkoutUrl: (r.checkout_url as string) ?? null,
    status: r.status as PaymentStatus, failureReason: (r.failure_reason as string) ?? null,
    createdAt: r.created_at as number, paidAt: (r.paid_at as number) ?? null, releasedAt: (r.released_at as number) ?? null,
    refundedAt: (r.refunded_at as number) ?? null, payoutAt: (r.payout_at as number) ?? null,
  };
}

export async function loadPaymentsMode(){
  try{
    const { data, error } = await sb().from('app_settings').select('value').eq('key', 'payments_mode').maybeSingle();
    if(error) throw error;
    const v = data && (data as { value?: string }).value;
    setPaymentsMode(v === 'mock' || v === 'live' ? v : 'off');
  }catch(e){ setPaymentsMode('off'); }
}

export async function loadPayments(){
  if(!sbRef || !currentUser) return;
  try{
    const { data, error } = await sb().from('payments').select('*');
    if(error) throw error;
    setPayments((data as Row[]).map(rowToPayment));
    refreshCurrentScreen();
  }catch(e){ console.error('payments load failed', e); }
}

/** Keeps `payments` fresh: realtime events + a slow poll as a safety net. Returns the unsubscribe function. */
export function subscribePayments(): () => void {
  if(!sbRef || paymentsMode === 'off') return () => {};
  void loadPayments();
  const channel = sb().channel('payments-changes-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => { void loadPayments(); dbRef?.reload(); })
    .subscribe();
  const poll = setInterval(() => { void loadPayments(); }, 30000);
  return () => { clearInterval(poll); sb().removeChannel(channel); };
}

/** The payment that currently matters for a job: a live one (pending/held/released/paid out), else the latest other. */
export function paymentFor(jobId: string): Payment | undefined {
  const mine = payments.filter(p => p.jobId === jobId).sort((a, b) => b.createdAt - a.createdAt);
  return mine.find(p => p.status === 'pending' || p.status === 'held' || p.status === 'released' || p.status === 'paid_out') || mine[0];
}
export function isFunded(jobId: string): boolean {
  const p = paymentFor(jobId);
  return !!p && (p.status === 'held' || p.status === 'released' || p.status === 'paid_out');
}
/** Payments are enforced for this job (mode on and the job is assigned but not finished). */
export function paymentRequired(j: Job): boolean {
  return paymentsMode !== 'off' && j.status === 'accepted';
}

let unsubPay: (() => void) | null = null;
/** Called after sign-in: learn the payments mode, then start keeping payments fresh (no-op when mode is 'off'). */
export async function startPayments(){
  await loadPaymentsMode();
  if(unsubPay){ unsubPay(); unsubPay = null; }
  unsubPay = subscribePayments();
  refreshCurrentScreen();
}
export function stopPayments(){
  if(unsubPay){ unsubPay(); unsubPay = null; }
  setPayments([]); setPaymentsMode('off'); setMockCheckoutId(null);
}

// ---------- actions (called from inline handlers) ----------
/** `providerPhone` = the applicant the customer chose ("assign & pay"); omitted for an already assigned, unpaid job. */
export async function startPayment(jobId: string, providerPhone?: string){
  const prov = providerFor(paymentsMode);
  if(!prov) return;
  try{
    const { data, error } = await sb().rpc('create_payment', { p_job_id: jobId, p_provider_phone: providerPhone ?? null });
    if(error) throw error;
    const p = rowToPayment(data as Row);
    await loadPayments();
    if(p.status === 'pending') await prov.begin(p);
  }catch(e){ console.error(e); toast(t().pay.toastError); }
}

export async function mockPay(paymentId: string, success: boolean){
  try{
    const { error } = await sb().rpc('mock_pay', { p_payment_id: paymentId, p_success: success });
    if(error) throw error;
    setMockCheckoutId(null);
    await loadPayments();
    dbRef?.reload();   // a successful payment assigns the job in the database
    toast(success ? t().pay.toastPaid : t().pay.toastFailed);
  }catch(e){ console.error(e); toast(t().pay.toastError); }
}
export function cancelMockCheckout(){ setMockCheckoutId(null); refreshCurrentScreen(); }

/** Admin: book a finished payout or refund (see admin_settle_payment in diz_payments.sql). */
export async function adminSettlePayment(paymentId: string, action: 'payout' | 'refund'){
  if(role !== 'admin') return;
  try{
    const { error } = await sb().rpc('admin_settle_payment', { p_payment_id: paymentId, p_action: action });
    if(error) throw error;
    await loadPayments();
    toast(t().pay.toastPaid);
  }catch(e){ console.error(e); toast(t().toastSaveFailed); }
}

// ---------- rendering ----------
const money = (n: number) => n + ' ' + t().priceUnit;
const NOTE = 'margin-top:8px;font-size:13px;';
const SUB = 'margin-top:6px;font-size:12.5px;color:var(--muted);';

function mockPanelHTML(p: Payment, who: string): string {
  const d = t().pay;
  return `<div class="adm-confirm" style="margin-top:10px;">
    <b>${d.mockTitle}</b>
    <div style="margin-top:4px;">${who ? d.payTo.replace('{name}', esc(who)) + ' · ' : ''}${money(p.amount)}</div>
    <div class="action-row">
      <button class="secondary" onclick="mockPay('${p.id}', true)">${d.mockPayBtn}</button>
      <button class="secondary" onclick="mockPay('${p.id}', false)">${d.mockFailBtn}</button>
      <button class="secondary" onclick="cancelMockCheckout()">${d.mockCancelBtn}</button>
    </div></div>`;
}

/** Checkout panel on an OPEN job's card, shown while the customer pays for the applicant they picked (mock provider). */
export function openJobPaymentHTML(j: Job): string {
  if(paymentsMode !== 'mock' || !mockCheckoutId) return '';
  const p = payments.find(x => x.id === mockCheckoutId && x.jobId === j.id && x.status === 'pending');
  if(!p) return '';
  const a = (Array.isArray(j.applicants) ? j.applicants : []).find(x => x.phone === p.providerPhone);
  return mockPanelHTML(p, a ? (a.name || a.phone) : p.providerPhone);
}

/** Payment block for the CUSTOMER's card (accepted job). */
export function customerPaymentHTML(j: Job): string {
  if(paymentsMode === 'off') return '';
  const d = t().pay, p = paymentFor(j.id);
  if(p && (p.status === 'held')) return `<div style="${NOTE}">🔒 ${d.held}</div>`;
  if(p && p.status === 'released') return `<div style="${NOTE}">${d.released}</div>`;
  if(p && p.status === 'paid_out') return `<div style="${NOTE}">${d.paidOut}</div>`;
  if(p && p.status === 'pending' && mockCheckoutId === p.id) return mockPanelHTML(p, '');
  const label = p && p.status === 'pending' ? d.pending : d.needPayCustomer;
  return `<div style="${NOTE}">${label}</div>
    <div class="action-row"><button class="secondary" onclick="startPayment('${j.id}')">${d.payBtn.replace('{amount}', money(j.price))}</button></div>`;
}

/** Payment line for the PROVIDER's card. `blocking` = the provider must wait for the customer's payment. */
export function providerPaymentHTML(j: Job): { html: string; blocking: boolean } {
  if(paymentsMode === 'off') return { html: '', blocking: false };
  const d = t().pay, p = paymentFor(j.id);
  if(!p || !(p.status === 'held' || p.status === 'released' || p.status === 'paid_out'))
    return { html: `<div style="${SUB}">${d.waitingPayProvider}</div>`, blocking: true };
  const txt = p.status === 'held' ? d.heldProvider
    : p.status === 'released' ? d.releasedProvider.replace('{amount}', money(p.payoutAmount))
    : d.paidOutProvider.replace('{amount}', money(p.payoutAmount));
  return { html: `<div style="${SUB}">🔒 ${txt}</div>`, blocking: false };
}

/** Payment status line for finished/cancelled jobs (both roles). */
export function settledPaymentHTML(j: Job, asProvider: boolean): string {
  const p = paymentFor(j.id);
  if(!p || paymentsMode === 'off') return '';
  const d = t().pay;
  const txt = p.status === 'released' ? (asProvider ? d.releasedProvider.replace('{amount}', money(p.payoutAmount)) : d.released)
    : p.status === 'paid_out' ? (asProvider ? d.paidOutProvider.replace('{amount}', money(p.payoutAmount)) : d.paidOut)
    : p.status === 'refund_due' && !asProvider ? d.refundDue
    : p.status === 'refunded' && !asProvider ? d.refunded : '';
  return txt ? `<div style="${SUB}">${txt}</div>` : '';
}

/** Admin: payment details + settle buttons for a job card. */
export function adminPaymentHTML(j: Job): string {
  const p = paymentFor(j.id);
  if(!p) return '';
  const d = t().pay;
  const label: Record<PaymentStatus, string> = {
    pending: d.pending, held: d.held, failed: '✕ ' + d.toastFailed, released: d.released, paid_out: d.paidOut,
    refund_due: d.refundDue, refunded: d.refunded,
  };
  const btn = p.status === 'released'
    ? `<button class="secondary" onclick="adminAsk('${j.id}','payout')">${d.settlePayout}</button>`
    : p.status === 'refund_due' ? `<button class="secondary" onclick="adminAsk('${j.id}','payrefund')">${d.settleRefund}</button>` : '';
  return `<div class="adm-row"><span>💳 ${d.admin}</span><b>${esc(label[p.status])} · ${money(p.amount)}${p.commission ? ' ('+d.adminCommission+' '+money(p.commission)+')' : ''} · ${esc(p.psp)}</b></div>`
    + (btn ? `<div class="action-row">${btn}</div>` : '');
}
