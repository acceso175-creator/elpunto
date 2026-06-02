import Stripe from 'stripe';
import { getSupabaseAdmin, json, parseBody } from './_supabaseAdmin.js';

const PRICE_CONFIRMATION_ERROR = 'Este pedido requiere confirmación de precio por WhatsApp antes de pagar.';
const currency = 'mxn';

function isNumericPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function optionExtra(selectedOptions = {}) {
  // Backend recalculates the same fixed option surcharge used by the cart UI.
  return Object.values(selectedOptions).some((value) => String(value).includes('+$25')) ? 25 : 0;
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

function cleanCartItem(item) {
  const quantity = Math.max(1, Number.parseInt(item?.quantity, 10) || 1);
  return {
    productId: item?.supabaseProductId || item?.productId || item?.id,
    quantity,
    selectedOptions: item?.selectedOptions && typeof item.selectedOptions === 'object' ? item.selectedOptions : {},
    removedIngredients: Array.isArray(item?.removedIngredients) ? item.removedIngredients : [],
    notes: item?.notes || ''
  };
}

async function loadProducts(supabase, productIds) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price, price_label, available')
    .in('id', productIds);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((product) => [product.id, product]));
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
    const cart = Array.isArray(body.cart) ? body.cart.map(cleanCartItem) : [];
    if (!cart.length) return json(400, { error: 'El carrito está vacío.' });
    if (body.paymentMethod !== 'pago_en_linea') return json(400, { error: 'Método de pago inválido para Stripe Checkout.' });

    const productIds = [...new Set(cart.map((item) => item.productId).filter(Boolean))];
    if (productIds.length !== cart.length && !productIds.length) {
      return json(400, { error: 'No se pudieron validar los productos del carrito en Supabase.' });
    }

    const supabase = getSupabaseAdmin();
    const productsById = await loadProducts(supabase, productIds);

    const orderItems = cart.map((item) => {
      const product = productsById.get(item.productId);
      if (!product || product.available === false) {
        throw new Error('Uno o más productos ya no están disponibles. Actualiza tu carrito e intenta de nuevo.');
      }
      if (!isNumericPrice(product.price)) {
        throw new Error(PRICE_CONFIRMATION_ERROR);
      }
      const unitPrice = Number(product.price) + optionExtra(item.selectedOptions);
      const lineTotal = unitPrice * item.quantity;
      return {
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        selected_options: item.selectedOptions,
        removed_ingredients: item.removedIngredients,
        notes: item.notes
      };
    });

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
    if (itemsError) throw new Error(itemsError.message);

    // Security: STRIPE_SECRET_KEY is used only in Netlify Functions; never expose it to React.
    // Security: prices are recalculated from Supabase with the service role; the frontend cart is not the source of truth.
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
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
    const statusCode = message === PRICE_CONFIRMATION_ERROR ? 400 : 500;
    return json(statusCode, { error: message });
  }
}
