import Stripe from 'stripe';
import { getSupabaseAdmin, json, parseBody } from './_supabaseAdmin.js';

const PRICE_CONFIRMATION_ERROR = 'Este pedido requiere confirmación de precio por WhatsApp antes de pagar.';
const currency = 'mxn';

function numericPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isNumericPrice(value) {
  return numericPrice(value) !== null;
}

function isDiscountActive(product) {
  return product?.discount_active === true || product?.discount_active === 'true' || product?.discount_active === 1;
}

function hasValidDiscount(product) {
  const price = Number(product?.price || 0);
  const discountPrice = Number(product?.discount_price || 0);
  return isDiscountActive(product) && Number.isFinite(price) && price > 0 && Number.isFinite(discountPrice) && discountPrice > 0 && discountPrice < price;
}

function getEffectivePrice(product) {
  const price = Number(product?.price || 0);
  const discountPrice = Number(product?.discount_price || 0);
  if (hasValidDiscount(product)) return discountPrice;
  return Number.isFinite(price) && price > 0 ? price : null;
}

function effectiveProductPrice(product) {
  return getEffectivePrice(product);
}

function validateAndPriceOptions(product, selectedOptions = []) {
  if (!Array.isArray(selectedOptions)) return Object.values(selectedOptions || {}).some((value) => String(value).includes('+$25')) ? 25 : 0;
  const selectedIds = new Set(selectedOptions.map((option) => option.optionId).filter(Boolean));
  let extra = 0;
  for (const group of product.product_option_groups || []) {
    if (group.is_active === false) continue;
    const activeOptions = (group.product_options || []).filter((option) => option.is_active !== false);
    const selected = activeOptions.filter((option) => selectedIds.has(option.id));
    const min = Math.max(group.required ? 1 : 0, Number(group.min_select) || 0);
    const max = group.selection_type === 'single' ? 1 : Math.max(min, Number(group.max_select) || 1);
    if (selected.length < min || selected.length > max) throw new Error(`Selección inválida para ${group.name}.`);
    extra += selected.reduce((sum, option) => sum + (Number(option.price_delta) || 0), 0);
    selected.forEach((option) => selectedIds.delete(option.id));
  }
  if (selectedIds.size) throw new Error('Una opción seleccionada ya no está disponible.');
  return extra;
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
  const [{ data: products, error: productsError }, { data: groups, error: groupsError }, { data: options, error: optionsError }] = await Promise.all([
    supabase.from('products').select('*').in('id', productIds),
    supabase.from('product_option_groups').select('id, product_id, name, required, selection_type, min_select, max_select, is_active').in('product_id', productIds),
    supabase.from('product_options').select('id, group_id, name, price_delta, is_active')
  ]);
  if (productsError) throw new Error(productsError.message);
  if (groupsError || optionsError) throw new Error(`No se pudieron validar las opciones del pedido: ${groupsError?.message || optionsError?.message}`);
  const optionsByGroup = new Map();
  (options || []).forEach((option) => optionsByGroup.set(option.group_id, [...(optionsByGroup.get(option.group_id) || []), option]));
  const groupsByProduct = new Map();
  (groups || []).forEach((group) => groupsByProduct.set(group.product_id, [...(groupsByProduct.get(group.product_id) || []), { ...group, product_options: optionsByGroup.get(group.id) || [] }]));
  return new Map((products || []).map((product) => [product.id, { ...product, product_option_groups: groupsByProduct.get(product.id) || [] }]));
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
      const effectivePrice = effectiveProductPrice(product);
      if (!isNumericPrice(effectivePrice)) {
        throw new Error(PRICE_CONFIRMATION_ERROR);
      }
      const unitPrice = effectivePrice + validateAndPriceOptions(product, item.selectedOptions);
      const lineTotal = unitPrice * item.quantity;
      const rawCost = product.cost === null || product.cost === undefined || product.cost === '' ? null : Number(product.cost);
      const cost = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : null;
      return {
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        unit_price: unitPrice,
        original_price: numericPrice(product.price),
        discount_price: hasValidDiscount(product) ? numericPrice(product.discount_price) : null,
        effective_price: effectivePrice,
        cost,
        line_profit: cost !== null ? (unitPrice - cost) * item.quantity : null,
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
