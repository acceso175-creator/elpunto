import { isAuthError, requireAdmin } from './_shared/requireAdmin.js';
import { getSupabaseAdmin, json } from './_supabaseAdmin.js';
const TZ = 'America/Chihuahua';
const PAYMENTS = ['efectivo', 'tarjeta', 'transferencia'];
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const periodKey = (date, groupBy) => { const d = new Date(date); const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); if (groupBy === 'month') return f.slice(0,7); if (groupBy === 'year') return f.slice(0,4); if (groupBy === 'week') { const base = new Date(`${f}T12:00:00Z`); const day = base.getUTCDay() || 7; base.setUTCDate(base.getUTCDate() - day + 1); return `${base.getUTCFullYear()}-W${String(Math.ceil((((base - new Date(Date.UTC(base.getUTCFullYear(),0,1))) / 86400000) + 1) / 7)).padStart(2,'0')}`; } return f; };
const emptyStats = () => ({ salesTotal: 0, paymentsCollected: 0, platformPendingTotal: 0, platformPendingOrders: 0, platformPaid: 0, platformPending: 0, totalSold: 0, efectivo: 0, tarjeta: 0, transferencia: 0, cortesia: 0, paidOrders: 0, pendingOrders: 0, canceledOrders: 0, averageTicket: 0, totalOrders: 0, domicilio: 0, mostrador: 0, recoger: 0 });
const sanitize = (row) => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'number' ? money(v) : v]));
const isActiveSale = (order) => order.status !== 'cancelado';
// totalSold/paymentsCollected representan dinero cobrado; salesTotal representa toda venta realizada aunque la plataforma aún no haya pagado.
const isCollected = (order) => order.status === 'pagado' && order.payment_method !== 'cortesia';
const isPlatformPendingSale = (order) => order.payment_method === 'plataformas' && order.status === 'pendiente';
const isSalesTotalOrder = (order) => isActiveSale(order) && order.payment_method !== 'cortesia' && (isCollected(order) || isPlatformPendingSale(order));
const addOrder = (stats, order) => {
  stats.totalOrders += 1;
  if (order.status === 'cancelado') stats.canceledOrders += 1;
  if (order.status === 'pendiente') stats.pendingOrders += 1;
  const total = Number(order.total || 0);
  if (order.payment_method === 'cortesia' && isActiveSale(order)) stats.cortesia += total;
  if (isSalesTotalOrder(order)) stats.salesTotal += total;
  if (order.payment_method === 'plataformas' && isActiveSale(order)) {
    if (order.status === 'pagado') stats.platformPaid += total;
    else { stats.platformPending += total; stats.platformPendingTotal += total; stats.platformPendingOrders += 1; }
  }
  if (isCollected(order)) {
    stats.totalSold += total; stats.paymentsCollected += total; stats.paidOrders += 1;
    if (PAYMENTS.includes(order.payment_method)) stats[order.payment_method] += total;
    if (['domicilio','mostrador','recoger'].includes(order.order_type)) stats[order.order_type] += total;
  }
  stats.averageTicket = stats.paidOrders ? money(stats.paymentsCollected / stats.paidOrders) : 0;
};
export async function handler(event) {
  try {
    const admin = await requireAdmin(event); if (isAuthError(admin)) return json(admin.statusCode, admin.body);
    const qs = event.queryStringParameters || {}; if (!qs.startDate || !qs.endDate) return json(400, { error: 'Fechas requeridas.' });
    const supabase = getSupabaseAdmin();
    let query = supabase.from('admin_orders').select('*, admin_order_items(*), order_edit_history(id, reason, edited_by, created_at)').gte('created_at', qs.startDate).lt('created_at', qs.endDate).order('created_at', { ascending: false }).limit(5000);
    if (qs.status) query = query.eq('status', qs.status); if (qs.paymentMethod) query = query.eq('payment_method', qs.paymentMethod);
    const { data, error } = await query; if (error) throw error;
    const orders = data || []; const summary = emptyStats(); const grouped = new Map(); const productMap = new Map(); const capturerMap = new Map();
    orders.forEach((order) => {
      addOrder(summary, order); const key = periodKey(order.created_at, qs.groupBy || 'day'); if (!grouped.has(key)) grouped.set(key, { period: key, ...emptyStats() }); addOrder(grouped.get(key), order);
      const collected = isCollected(order); const salesTotalOrder = isSalesTotalOrder(order); const courtesy = isActiveSale(order) && order.payment_method === 'cortesia'; if (!isActiveSale(order)) return;
      (order.admin_order_items || []).forEach((item) => { if (!productMap.has(item.product_name)) productMap.set(item.product_name, { product: item.product_name, quantity: 0, totalSold: 0, salesTotal: 0, averageTicket: 0, courtesies: 0 }); const row = productMap.get(item.product_name); if (collected) row.totalSold += Number(item.total_price || 0); if (salesTotalOrder) { row.quantity += Number(item.quantity || 0); row.salesTotal += Number(item.total_price || 0); } if (courtesy) row.courtesies += Number(item.quantity || 0); row.averageTicket = row.quantity ? money(row.salesTotal / row.quantity) : 0; });
      const cap = order.captured_by_name || order.captured_by || 'Sin identificar'; if (!capturerMap.has(cap)) capturerMap.set(cap, { capturedBy: cap, ...emptyStats() }); addOrder(capturerMap.get(cap), order);
    });
    return json(200, { timezone: TZ, summary: sanitize(summary), grouped: [...grouped.values()].sort((a,b) => a.period.localeCompare(b.period)).map(sanitize), orders, products: [...productMap.values()].sort((a,b) => b.quantity - a.quantity).map(sanitize), capturers: [...capturerMap.values()].sort((a,b) => b.salesTotal - a.salesTotal).map(sanitize) });
  } catch (error) { return json(500, { error: error.message || 'Error inesperado en histórico.' }); }
}
