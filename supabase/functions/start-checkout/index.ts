// Edge Function: start-checkout   (Deno / Supabase)  — SKELETON, not deployed or tested against Qi.
// Called by the app (src/payments.ts, liveProvider) with { paymentId }. Creates the payment at the provider with
// SECRET keys that never reach the browser, stores the provider's reference + hosted payment page URL, returns { url }.
//
// Deploy:  supabase functions deploy start-checkout
// Secrets: supabase secrets set QI_API_BASE=... QI_API_KEY=... PUBLIC_APP_URL=https://your-app.example
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { paymentId } = await req.json();
    const url = Deno.env.get('SUPABASE_URL')!;

    // 1) Who is calling? Use the caller's own JWT so row-level security decides what they may see.
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: payment } = await asUser.from('payments').select('*').eq('id', paymentId).maybeSingle();
    if (!payment || payment.status !== 'pending') return json({ error: 'payment not found or not pending' }, 404);

    // 2) Create the payment at the provider.
    // TODO(Qi): replace with the real "Create Payment" call from https://developers-gate.qi.iq/docs/ — authenticate
    // with QI_API_KEY, send amount (payment.amount, IQD), currency, a reference (payment.id), the customer's return
    // URL (PUBLIC_APP_URL) and our webhook URL (<SUPABASE_URL>/functions/v1/qi-webhook). Read the provider's payment id
    // and hosted-checkout URL from the response.
    const qi = { id: 'TODO-qi-payment-id', checkoutUrl: 'TODO-hosted-checkout-url' };

    // 3) Remember it (service role only) and send the customer there.
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await admin.rpc('attach_checkout', {
      p_payment_id: payment.id, p_psp_ref: qi.id, p_url: qi.checkoutUrl,
    });
    if (error) throw error;
    return json({ url: qi.checkoutUrl });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
