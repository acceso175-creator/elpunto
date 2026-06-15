import { getSupabaseAdmin, json, parseBody, validateAdminPin } from './_supabaseAdmin.js';
const TYPES = ['mostrador', 'domicilio', 'recoger'];
const PAYMENTS = ['efectivo', 'tarjeta', 'transferencia', 'cortesia'];
const STATUSES = ['pendiente', 'pagado', 'cancelado'];
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

export async function handler(event) {
  try {
    const body = event.httpMethod === 'GET' ? {} : parseBody(event);
    const pin = body.adminPin || event.headers['x-admin-pin'];
    if (!validateAdminPin(pin)) return json(401, { error: 'PIN de admin inválido.' });
    const supabase = getSupabaseAdmin();
    if (event.httpMethod === 'GET') {
      const from = event.queryStringParameters?.from;
      const to = event.queryStringParameters?.to;
      let query = supabase.from('admin_orders').select('*, admin_order_items(*)').order('created_at', { ascending: false }).limit(500);
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lt('created_at', to);
      const { data, error } = await query;
      if (error) throw error;
      return json(200, { orders: data || [] });
    }
    if (event.httpMethod === 'PATCH') {
      if (!body.id || body.status !== 'cancelado') return json(400, { error: 'Solo se permite cancelar un pedido válido.' });
      const { data, error } = await supabase.from('admin_orders').update({ status: 'cancelado' }).eq('id', body.id).select().single();
      if (error) throw error;
      return json(200, { order: data });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' });
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json(400, { error: 'No se puede guardar un pedido vacío.' });
    if (!TYPES.includes(body.orderType) || !PAYMENTS.includes(body.paymentMethod) || !STATUSES.includes(body.status)) return json(400, { error: 'Tipo, pago o estado inválido.' });
    if (!String(body.capturedBy || '').trim()) return json(400, { error: 'capturado_por es obligatorio.' });
    const cleanItems = items.map((item) => {
      const quantity = Number(item.quantity); const unitPrice = money(item.unitPrice);
      if (!Number.isInteger(quantity) || quantity < 1 || unitPrice < 0) throw new Error('Cantidad o precio inválido.');
      return { product_id: isUuid(item.productId) ? item.productId : null, product_name: String(item.productName || '').trim(), quantity, unit_price: unitPrice, total_price: money(quantity * unitPrice), selected_options: item.selectedOptions || null, item_notes: item.itemNotes || null };
    });
    const subtotal = money(cleanItems.reduce((sum, item) => sum + item.total_price, 0));
    const orderPayload = { customer_name: body.customerName || null, customer_phone: body.customerPhone || null, order_type: body.orderType, payment_method: body.paymentMethod, status: body.status, subtotal, discount_total: money(body.discountTotal), total: subtotal, notes: body.notes || null, captured_by: String(body.capturedBy).trim() };
    const { data: order, error } = await supabase.from('admin_orders').insert(orderPayload).select().single();
    if (error) throw error;
    const { error: itemsError } = await supabase.from('admin_order_items').insert(cleanItems.map((item) => ({ ...item, order_id: order.id })));
    if (itemsError) { await supabase.from('admin_orders').delete().eq('id', order.id); throw itemsError; }
    return json(201, { order });
  } catch (error) { return json(500, { error: error.message || 'Error inesperado en pedidos manuales.' }); }
}
