import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin, json, parseBody } from './_supabaseAdmin.js';
import { badRequest, isUuid, money, pricePortalCart } from './_shared/portalCart.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' });
  try {
    if ((event.body || '').length > 150000) throw badRequest('El pedido es demasiado grande.');
    const body = parseBody(event);
    if (!isUuid(body.requestId)) throw badRequest('Falta el identificador del pedido.');
    if (!['recoger','domicilio'].includes(body.orderType) || !['efectivo','tarjeta','transferencia','criptomonedas'].includes(body.paymentMethod)) throw badRequest('Entrega o pago inválidos.');
    const address = String(body.deliveryAddress || '').trim().slice(0,2000);
    if (body.orderType === 'domicilio' && !address) throw badRequest('Agrega la dirección o ubicación para el envío.');
    const supabase = getSupabaseAdmin();
    const existing = await supabase.from('orders').select('id, order_number, total, order_items(*)').eq('id', body.requestId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (!existing.data.order_items?.length) throw badRequest('El pedido se está guardando. Intenta nuevamente en unos segundos.', 409);
      return json(200, { orderId: existing.data.id, orderNumber: existing.data.order_number, total: existing.data.total, items: existing.data.order_items });
    }
    const items = await pricePortalCart(supabase, body.cart);
    const total = money(items.reduce((sum, item) => sum + item.line_total, 0));
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-','');
    const orderNumber = `EP-${day}-${randomUUID().slice(0,8).toUpperCase()}`;
    const inserted = await supabase.from('orders').insert({ id: body.requestId, order_number: orderNumber, customer_name: String(body.customerName || '').trim().slice(0,200) || null, customer_phone: String(body.customerPhone || '').trim().slice(0,40) || null, order_type: body.orderType, delivery_address: address || null, payment_method: body.paymentMethod, payment_status: 'pending', order_status: 'pending_confirmation', subtotal: total, total, currency: 'mxn', notes: String(body.notes || '').slice(0,2000) || null }).select('id, order_number').single();
    if (inserted.error) {
      if (inserted.error.code === '23505') throw badRequest('El pedido ya se está procesando. Intenta nuevamente en unos segundos.', 409);
      throw inserted.error;
    }
    const savedItems = await supabase.from('order_items').insert(items.map((item) => ({ ...item, order_id: inserted.data.id })));
    if (savedItems.error) {
      const cleanup = await supabase.from('orders').delete().eq('id', inserted.data.id);
      if (cleanup.error) console.error('[submit-portal-order] cleanup', cleanup.error);
      throw savedItems.error;
    }
    return json(201, { orderId: inserted.data.id, orderNumber: inserted.data.order_number, total, items });
  } catch (error) {
    if (!error.statusCode) console.error('[submit-portal-order]', error);
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : 'No se pudo registrar tu pedido. Intenta nuevamente.' });
  }
}
