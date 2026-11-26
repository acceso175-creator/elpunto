import { getSupabaseAdmin, json, parseBody } from './_supabaseAdmin.js';
import { pricePortalCart } from './_shared/portalCart.js';

const PRICE_CONFIRMATION_ERROR = 'Este pedido requiere confirmación de precio por WhatsApp antes de pagar.';
const currency = 'mxn';

async function createStripeCheckoutSession(secretKey, payload) {
  const params = new URLSearchParams();
  params.set('mode', payload.mode);
  params.set('success_url', payload.success_url);
  params.set('cancel_url', payload.cancel_url);
  params.set('client_reference_id', payload.client_reference_id);
  Object.entries(payload.metadata).forEach(([key, value]) => params.set(`metadata[${key}]`, value));
  Object.entries(payload.payment_intent_data.metadata).forEach(([key, value]) => params.set(`payment_intent_data[metadata][${key}]`, value));
  payload.line_items.forEach((item, index) => {
    params.set(`line_items[${index}][quantity]`, String(item.quantity));
    params.set(`line_items[${index}][price_data][currency]`, item.price_data.currency);
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.price_data.unit_amount));
    params.set(`line_items[${index}][price_data][product_data][name]`, item.price_data.product_data.name);
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const session = await response.json();
  if (!response.ok) throw new Error(session?.error?.message || 'Stripe no pudo crear la sesión de pago.');
  return session;
}

function createOrderNumber() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `EP-${y}${m}${d}-${h}${min}-${rand}`;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido. Usa POST.' });

  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const successUrl = process.env.STRIPE_SUCCESS_URL;
    const cancelUrl = process.env.STRIPE_CANCEL_URL;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!stripeSecretKey || !successUrl || !cancelUrl || !supabaseUrl || !supabaseServiceRoleKey) {
      return json(500, { error: 'Pago en línea todavía no está configurado.' });
    }

    const body = parseBody(event);
    const cart = Array.isArray(body.cart) ? body.cart : [];
    if (!cart.length) return json(400, { error: 'El carrito está vacío.' });
    if (body.paymentMethod !== 'pago_en_linea') return json(400, { error: 'Método de pago inválido para Stripe Checkout.' });

    if (!['recoger','domicilio'].includes(body.orderType) || (body.orderType === 'domicilio' && !String(body.deliveryAddress || '').trim())) return json(400, { error: 'Revisa los datos de entrega.' });
    const supabase = getSupabaseAdmin();
    const orderItems = await pricePortalCart(supabase, cart);

    const subtotal = orderItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
    const total = subtotal;
    const orderNumber = createOrderNumber();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        customer_name: body.customerName || null,
        customer_phone: body.customerPhone || null,
        order_type: body.orderType || 'recoger',
        delivery_address: body.deliveryAddress || null,
        payment_method: 'pago_en_linea',
        payment_status: 'pending',
        order_status: 'draft',
        subtotal,
        total,
        currency,
        notes: body.notes || null,
        whatsapp_message: body.whatsappMessage || null
      })
      .select('id, order_number')
      .single();
    if (orderError) throw new Error(orderError.message);

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems.map((item) => ({ ...item, order_id: order.id })));
    if (itemsError) { await supabase.from('orders').delete().eq('id', order.id); throw new Error(itemsError.message); }

    // Security: STRIPE_SECRET_KEY is used only in Netlify Functions; never expose it to React.
    // Security: prices are recalculated from Supabase with the service role; the frontend cart is not the source of truth.
    const session = await createStripeCheckoutSession(stripeSecretKey, {
      mode: 'payment',
      success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}order_id=${order.id}&order_number=${encodeURIComponent(order.order_number)}`,
      cancel_url: `${cancelUrl}${cancelUrl.includes('?') ? '&' : '?'}order_id=${order.id}`,
      client_reference_id: order.id,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        customer_phone: body.customerPhone || ''
      },
      payment_intent_data: {
        metadata: {
          order_id: order.id,
          order_number: order.order_number,
          customer_phone: body.customerPhone || ''
        }
      },
      line_items: orderItems.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency,
          unit_amount: Math.round(Number(item.unit_price) * 100),
          product_data: { name: item.product_name }
        }
      }))
    });

    const { error: sessionError } = await supabase
      .from('orders')
      .update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq('id', order.id);
    if (sessionError) throw new Error(sessionError.message);

    return json(200, { checkoutUrl: session.url, orderId: order.id, orderNumber: order.order_number });
  } catch (error) {
    const message = error.message || 'No se pudo crear la sesión de pago.';
    const statusCode = error.statusCode || (message === PRICE_CONFIRMATION_ERROR ? 400 : 500);
    return json(statusCode, { error: message });
  }
}

