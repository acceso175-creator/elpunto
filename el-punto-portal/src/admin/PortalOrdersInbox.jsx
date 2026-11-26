import React, { useEffect, useRef, useState } from 'react';

export default function PortalOrdersInbox({ onConfirmed, request, printReceipt, formatMoney, paymentLabel, optionsText }) {
  const [orders, setOrders] = useState([]);
  const [choices, setChoices] = useState({});
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [lastOrder, setLastOrder] = useState(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  async function load(silent = false) {
    const current = ++sequence.current;
    if (!silent) setMessage('Consultando pedidos del portal...');
    try {
      const result = await request('admin-orders', { method: 'GET' });
      if (!mounted.current || current !== sequence.current) return;
      setOrders(result.orders || []);
      if (!silent) setMessage(result.orders?.length ? 'Pedidos actualizados.' : 'No hay pedidos por confirmar.');
    } catch (error) { if (mounted.current && current === sequence.current) setMessage(error.message); }
  }
  useEffect(() => {
    mounted.current = true;
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 20000);
    const refresh = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', refresh);
    return () => { mounted.current = false; ++sequence.current; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  function choice(order) {
    return choices[order.id] || { paymentMethod: ['efectivo','tarjeta','transferencia'].includes(order.payment_method) ? order.payment_method : order.payment_method === 'pago_en_linea' ? 'tarjeta' : 'transferencia', status: order.payment_method === 'pago_en_linea' && order.payment_status === 'paid' ? 'pagado' : 'pendiente' };
  }
  async function confirmOrder(order) {
    if (busyId) return;
    setBusyId(order.id);
    setMessage('Confirmando pedido...');
    try {
      const result = await request('admin-orders', { body: { id: order.id, action: 'confirm', ...choice(order) } });
      if (!mounted.current) return;
      setLastOrder(result.order);
      setOrders((current) => current.filter((row) => row.id !== order.id));
      setMessage(result.alreadyConfirmed ? 'Este pedido ya estaba confirmado. Puedes imprimirlo.' : 'Pedido confirmado y agregado al corte. Ya puedes imprimir el ticket.');
      await onConfirmed?.(result.order);
    } catch (error) { if (mounted.current) setMessage(error.message); }
    finally { if (mounted.current) setBusyId(''); }
  }
  return <div className="panel admin-full portal-inbox">
    <div className="admin-header"><div><p className="eyebrow">Pedidos del portal</p><h3>Por confirmar ({orders.length})</h3></div><button type="button" className="button--ghost" disabled={!!busyId} onClick={() => load()}>Actualizar pedidos</button></div>
    <p className="small-note">Se actualiza cada 20 segundos. Confirma la disponibilidad y selecciona si el pago ya se recibió.</p>
    <p role="status" className="small-note">{message}</p>
    {lastOrder && <div className="portal-confirmed"><strong>{lastOrder.order_number} · {formatMoney(lastOrder.total)} · {lastOrder.status}</strong><button type="button" onClick={() => printReceipt(lastOrder)}>Imprimir ticket confirmado</button></div>}
    {!orders.length && <p>Sin pedidos pendientes de confirmación.</p>}
    <div className="portal-order-grid">{orders.map((order) => {
      const current = choice(order), verified = order.payment_method === 'pago_en_linea' && order.payment_status === 'paid';
      return <article className="portal-order" key={order.id}>
        <h4>{order.order_number}</h4><p>{order.customer_name || 'Cliente'}{order.customer_phone ? ` · ${order.customer_phone}` : ''}</p>
        <small>{new Date(order.created_at).toLocaleString('es-MX', { timeZone: 'America/Chihuahua' })} · {order.order_type === 'domicilio' ? 'A domicilio' : 'Para recoger'}</small>
        {(order.order_items || []).map((item) => <div className="portal-order-item" key={item.id}><strong>{item.quantity}× {item.product_name}</strong><span>{formatMoney(item.line_total)}</span><small>{optionsText(item.selected_options)}</small>{item.removed_ingredients?.length > 0 && <small>Sin: {item.removed_ingredients.join(', ')}</small>}{item.notes && <small>{item.notes}</small>}</div>)}
        {order.delivery_address && <p>Dirección: {order.delivery_address}</p>}{order.notes && <p>Notas: {order.notes}</p>}
        <strong>Total: {formatMoney(order.total)}</strong><p>Pago solicitado: {paymentLabel(order.payment_method)}{verified ? ' · Verificado por Stripe' : ' · Por verificar'}</p>
        <div className="form-grid">
          <label>Método de pago<select disabled={verified || !!busyId} value={current.paymentMethod} onChange={(event) => setChoices((prev) => ({ ...prev, [order.id]: { ...current, paymentMethod: event.target.value } }))}>{['efectivo','tarjeta','transferencia'].map((method) => <option value={method} key={method}>{paymentLabel(method)}</option>)}</select></label>
          <label>Estado de pago<select disabled={verified || !!busyId} value={current.status} onChange={(event) => setChoices((prev) => ({ ...prev, [order.id]: { ...current, status: event.target.value } }))}><option value="pendiente">Pendiente de cobrar</option><option value="pagado">Pago recibido</option></select></label>
        </div>
        <button type="button" disabled={!!busyId} onClick={() => confirmOrder(order)}>{busyId === order.id ? 'Confirmando...' : 'Confirmar pedido'}</button>
      </article>;
    })}</div>
  </div>;
}
