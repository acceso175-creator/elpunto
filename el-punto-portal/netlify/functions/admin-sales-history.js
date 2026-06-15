import { getSupabaseAdmin, json, validateAdminPin } from './_supabaseAdmin.js';
const GROUPS = ['day', 'week', 'month', 'year'];
const PAYMENTS = ['efectivo', 'tarjeta', 'transferencia'];
const TZ = 'America/Chihuahua';
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const localParts = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date)).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
const localKey = (date, groupBy) => { const p = localParts(date); if (groupBy === 'year') return p.year; if (groupBy === 'month') return `${p.year}-${p.month}`; if (groupBy === 'week') { const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); const q = localParts(d); return `${q.year}-W${Math.ceil((((d - new Date(Date.UTC(Number(q.year),0,1))) / 86400000) + 1) / 7).toString().padStart(2,'0')}`; } return `${p.year}-${p.month}-${p.day}`; };
const emptyStats = () => ({ totalSold: 0, efectivo: 0, tarjeta: 0, transferencia: 0, cortesia: 0, paidOrders: 0, pendingOrders: 0, canceledOrders: 0, averageTicket: 0, totalOrders: 0, domicilio: 0, mostrador: 0, recoger: 0 });
const addOrder = (stats, order) => { stats.totalOrders += 1; if (order.status === 'cancelado') stats.canceledOrders += 1; if (order.status === 'pendiente') stats.pendingOrders += 1; if (order.payment_method === 'cortesia' && order.status !== 'cancelado') stats.cortesia += Number(order.total || 0); const real = order.status === 'pagado' && order.payment_method !== 'cortesia'; if (real) { const total = Number(order.total || 0); stats.totalSold += total; stats.paidOrders += 1; if (PAYMENTS.includes(order.payment_method)) stats[order.payment_method] += total; if (['domicilio','mostrador','recoger'].includes(order.order_type)) stats[order.order_type] += total; } stats.averageTicket = stats.paidOrders ? money(stats.totalSold / stats.paidOrders) : 0; };

export async function handler(event) {
  try {
    const pin = event.headers['x-admin-pin'];
    if (!validateAdminPin(pin)) return json(401, { error: 'PIN de admin inválido.' });
    const qs = event.queryStringParameters || {}; const groupBy = GROUPS.includes(qs.groupBy) ? qs.groupBy : 'day';
    if (!qs.startDate || !qs.endDate) return json(400, { error: 'startDate y endDate son obligatorios.' });
    const supabase = getSupabaseAdmin();
    let query = supabase.from('admin_orders').select('*, admin_order_items(*)').gte('created_at', qs.startDate).lt('created_at', qs.endDate).order('created_at', { ascending: false }).limit(5000);
    if (qs.status) query = query.eq('status', qs.status);
    if (qs.paymentMethod) query = query.eq('payment_method', qs.paymentMethod);
    if (qs.capturedBy) query = query.eq('captured_by', qs.capturedBy);
    const { data, error } = await query; if (error) throw error;
    const orders = data || []; const summary = emptyStats(); const grouped = new Map(); const productMap = new Map(); const capturerMap = new Map();
    orders.forEach((order) => {
      addOrder(summary, order); const key = localKey(order.created_at, groupBy); if (!grouped.has(key)) grouped.set(key, { period: key, ...emptyStats() }); addOrder(grouped.get(key), order);
      if (!capturerMap.has(order.captured_by)) capturerMap.set(order.captured_by, { capturedBy: order.captured_by, ...emptyStats() }); addOrder(capturerMap.get(order.captured_by), order);
      const real = order.status === 'pagado' && order.payment_method !== 'cortesia'; const courtesy = order.status !== 'cancelado' && order.payment_method === 'cortesia'; if (order.status === 'cancelado') return;
      (order.admin_order_items || []).forEach((item) => { if (!productMap.has(item.product_name)) productMap.set(item.product_name, { product: item.product_name, quantity: 0, totalSold: 0, averageTicket: 0, courtesies: 0 }); const row = productMap.get(item.product_name); if (real) { row.quantity += Number(item.quantity || 0); row.totalSold += Number(item.total_price || 0); } if (courtesy) row.courtesies += Number(item.quantity || 0); row.averageTicket = row.quantity ? money(row.totalSold / row.quantity) : 0; });
    });
    const sanitize = (obj) => Object.fromEntries(Object.entries(obj).map(([k,v]) => [k, typeof v === 'number' ? money(v) : v]));
    return json(200, { timezone: TZ, summary: sanitize(summary), grouped: [...grouped.values()].sort((a,b) => a.period.localeCompare(b.period)).map(sanitize), orders, products: [...productMap.values()].sort((a,b) => b.quantity - a.quantity).map(sanitize), capturers: [...capturerMap.values()].sort((a,b) => b.totalSold - a.totalSold).map(sanitize) });
  } catch (error) { return json(500, { error: error.message || 'Error inesperado en histórico.' }); }
}
