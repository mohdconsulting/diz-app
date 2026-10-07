// Edge Function: qi-webhook   (Deno / Supabase)  — SKELETON, not deployed or tested against Qi.
// The provider calls this when a customer has paid (or failed). It is the ONLY thing that may mark a live payment
// as paid, via confirm_payment() (service role). The browser's "I paid" is never trusted.
//
// Deploy WITHOUT JWT verification (the provider has no Supabase login):  supabase functions deploy qi-webhook --no-verify-jwt
// Secrets: supabase secrets set QI_WEBHOOK_SECRET=...
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const raw = await req.text();

    // 1) TODO(Qi): authenticate the request exactly as the provider documents (signature header / shared secret /
    //    IP allow-list). Reject anything else with 401 — otherwise anyone could mark payments as paid.
    // if (!verifySignature(raw, req.headers, Deno.env.get('QI_WEBHOOK_SECRET')!)) return new Response('unauthorized', { status: 401 });

    // 2) TODO(Qi): parse the provider's payload. Even after a valid signature, re-check the status with the provider's
    //    "Payment Status" endpoint before trusting it. Map their fields to:
    const event = JSON.parse(raw) as { reference: string; pspRef: string; status: 'paid' | 'failed'; reason?: string };

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // confirm_payment / fail_payment are idempotent, so retried webhooks are harmless.
    const { error } = event.status === 'paid'
      ? await admin.rpc('confirm_payment', { p_payment_id: event.reference, p_psp_ref: event.pspRef })
      : await admin.rpc('fail_payment', { p_payment_id: event.reference, p_reason: event.reason ?? 'failed at provider' });
    if (error) throw error;
    return new Response('ok');
  } catch (e) {
    console.error(e);
    return new Response('error', { status: 500 });   // non-2xx makes the provider retry
  }
});
