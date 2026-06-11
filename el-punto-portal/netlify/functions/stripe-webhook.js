import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin, json } from './_supabaseAdmin.js';

function rawBody(event) {
  return event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');
}

function stripeSignature(event) {
  return event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
}

function constructStripeEvent(event, secret, toleranceSeconds = 300) {
  const signature = stripeSignature(event);
  if (!signature) throw new Error('Falta Stripe-Signature.');
  const parts = signature.split(',').reduce((result, part) => {
    const [key, value] = part.split('=');
    if (key && value) result[key] = [...(result[key] || []), value];
    return result;
  }, {});
  const timestamp = Number(parts.t?.[0]);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) throw new Error('La firma expiró.');
  const payload = rawBody(event);
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest('hex');
  const valid = (parts.v1 || []).some((signatureValue) => {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(signatureValue, 'hex');
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  });
  if (!valid) throw new Error('La firma no coincide.');
  return JSON.parse(payload.toString('utf8'));
}

async function updateOrderById(supabase, orderId, payload) {
  if (!orderId) return null;
  const { data, error } = await supabase
    .from('orders')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .select('id, total, currency')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function findOrderByPaymentIntent(supabase, paymentIntentId) {
  if (!paymentIntentId) return null;
  const { data, error } = await supabase
    .from('orders')
    .select('id, total, currency')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function insertPayment(supabase, payment) {
  const { error } = await supabase.from('payments').insert(payment);
  if (error) throw new Error(error.message);
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' });

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return json(500, { error: 'Falta STRIPE_WEBHOOK_SECRET.' });
  let stripeEvent;

  try {
    // Security: the webhook must verify Stripe-Signature against the raw payload and STRIPE_WEBHOOK_SECRET.
    stripeEvent = constructStripeEvent(event, webhookSecret);
  } catch (error) {
    return json(400, { error: `Firma de Stripe inválida: ${error.message}` });
  }

  try {
    const supabase = getSupabaseAdmin();
    const object = stripeEvent.data.object;

    if (stripeEvent.type === 'checkout.session.completed') {
      const orderId = object.metadata?.order_id || object.client_reference_id;
      const order = await updateOrderById(supabase, orderId, {
        payment_status: 'paid',
        order_status: 'paid',
        stripe_payment_intent_id: object.payment_intent || null
      });
      await insertPayment(supabase, {
        order_id: orderId,
        provider_status: 'paid',
        amount: object.amount_total ? object.amount_total / 100 : order?.total || null,
        currency: object.currency || order?.currency || 'mxn',
        stripe_checkout_session_id: object.id,
        stripe_payment_intent_id: object.payment_intent || null,
        raw_event: stripeEvent
      });
    }

    if (stripeEvent.type === 'checkout.session.expired') {
      const orderId = object.metadata?.order_id || object.client_reference_id;
      await updateOrderById(supabase, orderId, {
        payment_status: 'expired',
        order_status: 'payment_expired'
      });
    }

    if (stripeEvent.type === 'payment_intent.payment_failed') {
      const orderId = object.metadata?.order_id;
      const order = orderId ? await updateOrderById(supabase, orderId, {
        payment_status: 'failed',
        order_status: 'payment_failed',
        stripe_payment_intent_id: object.id
      }) : await findOrderByPaymentIntent(supabase, object.id);
      if (order?.id) {
        await insertPayment(supabase, {
          order_id: order.id,
          provider_status: 'failed',
          amount: object.amount ? object.amount / 100 : order.total || null,
          currency: object.currency || order.currency || 'mxn',
          stripe_payment_intent_id: object.id,
          raw_event: stripeEvent
        });
      }
    }

    return json(200, { received: true });
  } catch (error) {
    return json(500, { error: error.message || 'No se pudo procesar webhook de Stripe.' });
  }
}
