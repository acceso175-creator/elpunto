import { isAuthError, requireAdmin } from './_shared/requireAdmin.js';
import { getSupabaseAdmin, json, parseBody } from './_supabaseAdmin.js';

export async function handler(event) {
  try {
    const body = event.httpMethod === 'GET' ? {} : parseBody(event);
    const admin = await requireAdmin(event);
    if (isAuthError(admin)) return json(admin.statusCode, admin.body);
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido.' });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, total, payment_method, payment_status, order_status, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return json(200, { orders: data || [] });
  } catch (error) {
    return json(500, { error: error.message || 'Error inesperado en órdenes.' });
  }
}
