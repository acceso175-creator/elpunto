import { isAuthError, requireAdmin } from './_shared/requireAdmin.js';
import { getSupabaseAdmin, json, parseBody } from './_supabaseAdmin.js';
import { insertManualOrder } from './admin-manual-orders.js';
import { badRequest, isUuid, money } from './_shared/portalCart.js';

async function capturedOrder(supabase, id) {
  const result = await supabase.from('admin_orders').select('*, admin_order_items(*)').eq('id', id).maybeSingle();
  if (result.error) throw result.error;
  if (result.data && !result.data.admin_order_items?.length) throw badRequest('El pedido se está confirmando. Actualiza en unos segundos.', 409);
  return result.data;
}

export async function handler(event) {
  try {
    const admin = await requireAdmin(event);
    if (isAuthError(admin)) return json(admin.statusCode, admin.body);
    const supabase = getSupabaseAdmin();
    if (event.httpMethod === 'GET') {
      // Include all outstanding orders, not just the 50 most recent Stripe drafts.
      const orders = [];
      for (let offset = 0; ; offset += 500) {
        const result = await supabase.from('orders').select('*, order_items(*)').or('order_status.eq.pending_confirmation,payment_status.eq.paid,order_status.eq.confirmed').order('created_at', { ascending: false }).range(offset, offset + 499);
        if (result.error) throw result.error;
        orders.push(...(result.data || []));
        if ((result.data || []).length < 500) break;
      }
      const captured = [];
      for (let offset = 0; offset < orders.length; offset += 200) {
        const result = await supabase.from('admin_orders').select('id, order_number, status').in('id', orders.slice(offset, offset + 200).map((order) => order.id));
        if (result.error) throw result.error;
        captured.push(...(result.data || []));
      }
      const capturedById = new Map(captured.map((order) => [order.id, order]));
      const result = orders.map((order) => ({ ...order, confirmedOrder: capturedById.get(order.id) || null }));
      return json(200, { orders: result.filter((order) => !order.confirmedOrder), recentConfirmed: result.filter((order) => order.confirmedOrder).slice(0,10) });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' });
    const body = parseBody(event);
    if (body.action !== 'confirm' || !isUuid(body.id)) throw badRequest('Pedido o acción inválidos.');
    const existing = await capturedOrder(supabase, body.id);
    if (existing) return json(200, { order: existing, alreadyConfirmed: true });
    const sourceResult = await supabase.from('orders').select('*, order_items(*)').eq('id', body.id).single();
    if (sourceResult.error) throw sourceResult.error;
    const source = sourceResult.data;
    if (!source?.order_items?.length) throw badRequest('El pedido no tiene productos guardados.');
    if (source.payment_method === 'pago_en_linea' && source.payment_status !== 'paid') throw badRequest('El pago de Stripe todavía no está confirmado.');
    if (!['pending_confirmation','paid','confirmed'].includes(source.order_status) && source.payment_status !== 'paid') throw badRequest('Este pedido no está disponible para confirmar.');
    const verifiedPaid = source.payment_method === 'pago_en_linea' && source.payment_status === 'paid';
    const payment = verifiedPaid ? 'tarjeta' : body.paymentMethod;
    const status = verifiedPaid ? 'pagado' : body.status;
    if (!['efectivo','tarjeta','transferencia'].includes(payment) || !['pendiente','pagado'].includes(status)) throw badRequest('Selecciona el método y el estado de pago.');
    const items = source.order_items.map((item) => {
      const quantity = Number(item.quantity), unitPrice = Number(item.unit_price), total = money(quantity * unitPrice);
      if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) throw badRequest('El pedido tiene importes inválidos.');
      return { product_id: item.product_id || null, product_name: item.product_name, quantity, unit_price: unitPrice, total_price: total, selected_options: item.selected_options, item_notes: [item.removed_ingredients?.length ? `Sin: ${item.removed_ingredients.join(', ')}` : '', item.notes].filter(Boolean).join(' · ') || null };
    });
    const subtotal = money(items.reduce((sum, item) => sum + item.total_price, 0));
    if (Math.abs(subtotal - Number(source.total)) > 0.01) throw badRequest('El total guardado no coincide con los productos. Revisa el pedido.');
    const name = admin.displayName || admin.email || 'admin';
    // Reuse the source UUID and folio. Unique constraints prevent two admins
    // (or a retried request) from registering the same sale twice.
    const inserted = await insertManualOrder(supabase, { id: source.id, order_number: source.order_number, customer_name: source.customer_name, customer_phone: source.customer_phone, order_type: source.order_type === 'domicilio' ? 'domicilio' : 'recoger', payment_method: payment, status, paid_at: status === 'pagado' ? new Date().toISOString() : null, subtotal, discount_total: 0, total: subtotal, notes: [source.notes, source.delivery_address && `Dirección: ${source.delivery_address}`, `Pedido del portal: ${source.order_number}`, source.payment_method === 'criptomonedas' && 'Pago solicitado originalmente con criptomonedas'].filter(Boolean).join('\n'), captured_by: name, captured_by_name: name, captured_by_user_id: admin.userId, updated_by: name });
    if (inserted.error) {
      if (inserted.error.code === '23505') {
        const winner = await capturedOrder(supabase, source.id);
        if (winner) return json(200, { order: winner, alreadyConfirmed: true });
        throw badRequest('El pedido ya se está confirmando. Actualiza en unos segundos.', 409);
      }
      throw inserted.error;
    }
    const itemsResult = await supabase.from('admin_order_items').insert(items.map((item) => ({ ...item, order_id: source.id }))).select();
    if (itemsResult.error) {
      const cleanup = await supabase.from('admin_orders').delete().eq('id', source.id);
      if (cleanup.error) console.error('[confirm portal order cleanup]', cleanup.error);
      throw itemsResult.error;
    }
    const marked = await supabase.from('orders').update({ order_status: 'confirmed' }).eq('id', source.id);
    if (marked.error) console.error('[confirm portal source status]', marked.error);
    return json(201, { order: { ...inserted.data, admin_order_items: itemsResult.data || [] } });
  } catch (error) { return json(error.statusCode || 500, { error: error.message || 'No se pudieron procesar los pedidos del portal.' }); }
}

