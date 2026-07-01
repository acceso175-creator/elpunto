import { getSupabaseAdmin, json, parseBody, validateAdminPin } from './_supabaseAdmin.js';
const TYPES = ['mostrador', 'domicilio', 'recoger'];
const PAYMENTS = ['efectivo', 'tarjeta', 'transferencia', 'cortesia', 'plataformas'];
const STATUSES = ['pendiente', 'pagado', 'cancelado'];
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ''));
const normalizeItems = (items = []) => items.map((item) => {
  const quantity = Number(item.quantity); const unitPrice = money(item.unitPrice ?? item.unit_price);
  if (!Number.isInteger(quantity) || quantity < 1 || unitPrice < 0) throw new Error('Cantidad o precio inválido.');
  const productName = String(item.productName || item.product_name || '').trim();
  if (!productName) throw new Error('Cada producto necesita nombre.');
  return { product_id: isUuid(item.productId || item.product_id) ? (item.productId || item.product_id) : null, product_name: productName, quantity, unit_price: unitPrice, total_price: money(quantity * unitPrice), selected_options: item.selectedOptions ?? item.selected_options ?? null, item_notes: item.itemNotes ?? item.item_notes ?? null };
});
const orderSnapshot = (order) => order ? { ...order, admin_order_items: order.admin_order_items || [] } : null;
async function fetchOrder(supabase, id) {
  const { data, error } = await supabase.from('admin_orders').select('*, admin_order_items(*)').eq('id', id).single();
  if (error) throw error;
  return data;
}
async function recordHistory(supabase, orderId, previousData, newData, reason, editedBy = 'admin') {
  const { error } = await supabase.from('order_edit_history').insert({ order_id: orderId, previous_data: previousData, new_data: newData, reason: String(reason || '').trim(), edited_by: String(editedBy || 'admin').trim() || 'admin' });
  if (error) console.error('[order_edit_history]', error.message || error);
}
export async function handler(event) {
  try {
    const body = event.httpMethod === 'GET' ? {} : parseBody(event);
    const pin = body.adminPin || event.headers['x-admin-pin'];
    if (!validateAdminPin(pin)) return json(401, { error: 'PIN de admin inválido.' });
    const supabase = getSupabaseAdmin();
    if (event.httpMethod === 'GET') {
      const from = event.queryStringParameters?.from; const to = event.queryStringParameters?.to; const paymentStatus = event.queryStringParameters?.paymentStatus;
      let query = supabase.from('admin_orders').select('*, admin_order_items(*), order_edit_history(id, reason, edited_by, created_at)').order('created_at', { ascending: false }).limit(500);
      if (from) query = query.gte('created_at', from); if (to) query = query.lt('created_at', to); if (paymentStatus) query = query.eq('status', paymentStatus);
      const { data, error } = await query; if (error) throw error;
      return json(200, { orders: data || [] });
    }
    if (event.httpMethod === 'PATCH') {
      if (!body.id) return json(400, { error: 'Falta id de pedido.' });
      const previous = await fetchOrder(supabase, body.id);
      if (body.action === 'mark-paid' || body.action === 'mark-pending') {
        if (previous.payment_method !== 'plataformas') return json(400, { error: 'Solo pedidos de plataformas pueden cambiar pago pendiente/pagado.' });
        const nextStatus = body.action === 'mark-paid' ? 'pagado' : 'pendiente';
        const patch = { status: nextStatus, paid_at: nextStatus === 'pagado' ? new Date().toISOString() : null, updated_by: body.editedBy || 'admin' };
        const { error } = await supabase.from('admin_orders').update(patch).eq('id', body.id); if (error) throw error;
        const next = await fetchOrder(supabase, body.id); await recordHistory(supabase, body.id, orderSnapshot(previous), orderSnapshot(next), body.reason || (nextStatus === 'pagado' ? 'Marcado como pagado' : 'Revertido a pendiente'), body.editedBy || 'admin');
        return json(200, { order: next });
      }
      if (body.status === 'cancelado') {
        const { error } = await supabase.from('admin_orders').update({ status: 'cancelado', updated_by: body.editedBy || 'admin' }).eq('id', body.id); if (error) throw error;
        const next = await fetchOrder(supabase, body.id); await recordHistory(supabase, body.id, orderSnapshot(previous), orderSnapshot(next), body.reason || 'Cancelación de pedido', body.editedBy || 'admin');
        return json(200, { order: next });
      }
      if (body.action !== 'edit') return json(400, { error: 'Acción inválida.' });
      if (!String(body.reason || '').trim()) return json(400, { error: 'Escribe el motivo de la modificación.' });
      if (!TYPES.includes(body.orderType) || !PAYMENTS.includes(body.paymentMethod) || !STATUSES.includes(body.status)) return json(400, { error: 'Tipo, pago o estado inválido.' });
      const cleanItems = normalizeItems(body.items || []); if (!cleanItems.length) return json(400, { error: 'El pedido no puede quedar vacío.' });
      const subtotal = money(cleanItems.reduce((sum, item) => sum + item.total_price, 0)); const discount = money(body.discountTotal); const total = Math.max(0, money(subtotal - discount));
      const patch = { customer_name: body.customerName || null, customer_phone: body.customerPhone || null, order_type: body.orderType, payment_method: body.paymentMethod, status: body.paymentMethod === 'plataformas' && body.status !== 'pagado' ? 'pendiente' : body.status, subtotal, discount_total: discount, total, notes: body.notes || null, updated_by: body.editedBy || 'admin' };
      if (patch.payment_method === 'plataformas' && patch.status === 'pagado' && !previous.paid_at) patch.paid_at = new Date().toISOString();
      if (patch.status !== 'pagado') patch.paid_at = null;
      const { error: orderError } = await supabase.from('admin_orders').update(patch).eq('id', body.id); if (orderError) throw orderError;
      const { error: deleteError } = await supabase.from('admin_order_items').delete().eq('order_id', body.id); if (deleteError) throw deleteError;
      const { error: itemsError } = await supabase.from('admin_order_items').insert(cleanItems.map((item) => ({ ...item, order_id: body.id }))); if (itemsError) throw itemsError;
      const next = await fetchOrder(supabase, body.id); await recordHistory(supabase, body.id, orderSnapshot(previous), orderSnapshot(next), body.reason, body.editedBy || 'admin');
      return json(200, { order: next });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' });
    const cleanItems = normalizeItems(Array.isArray(body.items) ? body.items : []); if (!cleanItems.length) return json(400, { error: 'No se puede guardar un pedido vacío.' });
    if (!TYPES.includes(body.orderType) || !PAYMENTS.includes(body.paymentMethod) || !STATUSES.includes(body.status)) return json(400, { error: 'Tipo, pago o estado inválido.' });
    if (!String(body.capturedBy || '').trim()) return json(400, { error: 'capturado_por es obligatorio.' });
    const subtotal = money(cleanItems.reduce((sum, item) => sum + item.total_price, 0)); const discount = money(body.discountTotal); const status = body.paymentMethod === 'plataformas' ? 'pendiente' : body.status;
    const orderPayload = { customer_name: body.customerName || null, customer_phone: body.customerPhone || null, order_type: body.orderType, payment_method: body.paymentMethod, status, paid_at: status === 'pagado' ? new Date().toISOString() : null, subtotal, discount_total: discount, total: Math.max(0, money(subtotal - discount)), notes: body.notes || null, captured_by: String(body.capturedBy).trim(), updated_by: body.capturedBy || 'admin' };
    const { data: order, error } = await supabase.from('admin_orders').insert(orderPayload).select().single(); if (error) throw error;
    const { error: itemsError } = await supabase.from('admin_order_items').insert(cleanItems.map((item) => ({ ...item, order_id: order.id }))); if (itemsError) { await supabase.from('admin_orders').delete().eq('id', order.id); throw itemsError; }
    return json(201, { order });
  } catch (error) { return json(500, { error: error.message || 'Error inesperado en pedidos manuales.' }); }
}
