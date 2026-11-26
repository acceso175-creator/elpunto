import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createDatabase } from './helpers/database.mjs';
import { loadOptionCatalog } from '../netlify/functions/_shared/productOptions.js';
import { priceOptions, pricePortalCart } from '../netlify/functions/_shared/portalCart.js';

let database, authError = false;
const admin = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Andrés' };
mock.module('../netlify/functions/_shared/requireAdmin.js', { namedExports: { requireAdmin: async () => authError ? { statusCode: 401, body: { error: 'Sesión requerida' } } : admin, isAuthError: (value) => !!value.statusCode } });
mock.module('../netlify/functions/_supabaseAdmin.js', { namedExports: { getSupabaseAdmin: () => database, parseBody: (event) => JSON.parse(event.body || '{}'), json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }) } });
const { handler: submit } = await import('../netlify/functions/submit-portal-order.js');
const { handler: confirm } = await import('../netlify/functions/admin-orders.js');
const { handler: edit } = await import('../netlify/functions/admin-manual-orders.js');
const productId = '22222222-2222-4222-8222-222222222222', orderId = '33333333-3333-4333-8333-333333333333';
const secondProduct = '44444444-4444-4444-8444-444444444444';
function seed() {
  const template = { id: 'template', name: 'Hazlo combo', required: false, selection_type: 'single', min_select: 0, max_select: 1, active: true };
  return { products: [{ id: productId, name: 'Torta', price: 100, discount_active: true, discount_price: 95, available: true }],
    product_ingredients: [{ product_id: productId, name: 'Cebolla', removable: true }, { product_id: productId, name: 'Pan', removable: false }],
    product_option_groups: [{ id: 'protein', product_id: productId, name: 'Proteína', required: true, selection_type: 'single', min_select: 1, max_select: 1, is_active: true }],
    product_options: [{ id: 'egg', group_id: 'protein', name: 'Huevo', price_delta: 0, is_active: true }],
    product_option_templates: [productId,secondProduct].map((id) => ({ id: `assignment-${id}`, product_id: id, template_id: 'template', active: true, option_group_templates: template })),
    option_template_items: [{ id: 'combo', template_id: 'template', name: 'Papas y jugo', price_delta: 55, active: true }],
    admin_orders: [], admin_order_items: [], orders: [], order_items: [] };
}
const cart = [{ productId, quantity: 2, unitPrice: 1, selectedOptions: [{ optionId: 'egg', priceDelta: 999 }, { optionId: 'tplopt-combo', priceDelta: 1 }], removedIngredients: ['Cebolla'], notes: 'Salsa aparte' }];
const request = (method, body) => ({ httpMethod: method, body: JSON.stringify(body) });
const payload = { requestId: orderId, cart, customerName: 'Cliente prueba', customerPhone: '6141234567', orderType: 'domicilio', deliveryAddress: 'Dirección de prueba', paymentMethod: 'efectivo', notes: 'Prueba' };
async function place() { const response = await submit(request('POST',payload)); assert.equal(response.statusCode,201,response.body); return JSON.parse(response.body); }

test('shared template catalog does not duplicate prices across products', async () => {
  database = createDatabase(seed());
  const catalog = await loadOptionCatalog(database,[productId,secondProduct]);
  assert.equal(catalog.groups.filter((group) => group.template_id).length,2);
  assert.equal(catalog.options.filter((option) => option.id === 'tplopt-combo').length,1);
  const items = await pricePortalCart(database,cart);
  assert.equal(items[0].unit_price,150);
  assert.equal(items[0].line_total,300);
  assert.deepEqual(items[0].removed_ingredients,['Cebolla']);
  assert.equal(items[0].selected_options[1].priceDelta,55);
});
test('required, excessive, duplicated, inactive and forged options are rejected', () => {
  const groups = [{ id:'g',name:'Proteína',required:true,selection_type:'single',min_select:1,max_select:1 }];
  const options = [{ id:'a',group_id:'g',name:'A',price_delta:0 },{ id:'b',group_id:'g',name:'B',price_delta:20 }];
  for (const selected of [[],[{optionId:'a'},{optionId:'b'}],[{optionId:'a'},{optionId:'a'}],[{optionId:'unknown'}],[{name:'fake',priceDelta:0}]]) assert.throws(() => priceOptions(groups,options,selected));
  assert.throws(() => priceOptions(groups,[{...options[0],is_active:false}], [{optionId:'a'}]));
});
test('invalid quantities and ingredient removal never create orders', async () => {
  for (const quantity of [0,-1,1.5,101,Infinity]) {
    database = createDatabase(seed());
    const response = await submit(request('POST',{...payload,cart:[{...cart[0],quantity}]}));
    assert.equal(response.statusCode,400); assert.equal(database.state.orders.length,0);
  }
  database = createDatabase(seed());
  const response = await submit(request('POST',{...payload,cart:[{...cart[0],removedIngredients:['Pan']}]}));
  assert.equal(response.statusCode,400); assert.equal(database.state.orders.length,0);
});
test('WhatsApp submission persists canonical prices and reuses the same order on retries', async () => {
  database = createDatabase(seed());
  const first = await place();
  const repeated = await submit(request('POST',payload));
  assert.equal(repeated.statusCode,200);
  assert.equal(JSON.parse(repeated.body).orderNumber,first.orderNumber);
  assert.equal(database.state.orders.length,1);
  assert.equal(database.state.order_items.length,1);
  assert.equal(database.state.orders[0].total,300);
  assert.equal(database.state.orders[0].order_status,'pending_confirmation');
  assert.equal(database.state.admin_orders.length,0);
});
test('portal item failure cleans the draft so a retry can succeed', async () => {
  let fail = true;
  database = createDatabase(seed(),{fail: (query) => fail && query.table === 'order_items' && query.action === 'insert' ? (fail=false,{message:'Insert failed'}) : null});
  assert.equal((await submit(request('POST',payload))).statusCode,500);
  assert.equal(database.state.orders.length,0);
  await place();
  assert.equal(database.state.orders.length,1);
});
test('confirmation preserves options and removals, enters the cut once and prints persisted items', async () => {
  database = createDatabase(seed()); await place();
  const inbox = JSON.parse((await confirm({httpMethod:'GET'})).body);
  assert.equal(inbox.orders.length,1);
  const first = await confirm(request('POST',{id:orderId,action:'confirm',paymentMethod:'efectivo',status:'pendiente',total:1}));
  assert.equal(first.statusCode,201,first.body);
  const order = JSON.parse(first.body).order;
  assert.equal(order.id,orderId); assert.equal(order.total,300); assert.equal(order.status,'pendiente');
  assert.equal(order.captured_by,admin.displayName);
  assert.match(order.admin_order_items[0].item_notes,/Sin: Cebolla/);
  assert.match(order.notes,/Dirección de prueba/);
  const repeated = await confirm(request('POST',{id:orderId,action:'confirm',paymentMethod:'tarjeta',status:'pagado'}));
  assert.equal(repeated.statusCode,200); assert.equal(JSON.parse(repeated.body).alreadyConfirmed,true);
  assert.equal(database.state.admin_orders.length,1);
  assert.equal(database.state.admin_orders[0].status,'pendiente');
  assert.equal(database.state.admin_order_items.length,1);
  assert.equal(JSON.parse((await confirm({httpMethod:'GET'})).body).orders.length,0);
});
test('concurrent confirmations cannot duplicate a sale', async () => {
  database = createDatabase(seed()); await place();
  const body = {id:orderId,action:'confirm',paymentMethod:'efectivo',status:'pagado'};
  const results = await Promise.all([confirm(request('POST',body)),confirm(request('POST',body))]);
  assert.equal(results.filter((response) => response.statusCode === 201).length,1);
  assert.ok(results.every((response) => [200,201,409].includes(response.statusCode)),JSON.stringify(results));
  assert.equal(database.state.admin_orders.length,1); assert.equal(database.state.admin_order_items.length,1);
  assert.equal((await confirm(request('POST',body))).statusCode,200);
});
test('failed confirmation leaves the portal order available for another attempt', async () => {
  let fail=true;
  database = createDatabase(seed(),{fail:(query) => fail && query.table==='admin_order_items' && query.action==='insert' ? (fail=false,{message:'Failed items'}) : null}); await place();
  const body={id:orderId,action:'confirm',paymentMethod:'efectivo',status:'pagado'};
  assert.equal((await confirm(request('POST',body))).statusCode,500);
  assert.equal(database.state.admin_orders.length,0);
  assert.equal(JSON.parse((await confirm({httpMethod:'GET'})).body).orders.length,1);
  assert.equal((await confirm(request('POST',body))).statusCode,201);
});
test('unverified Stripe payment cannot be confirmed; verified Stripe stays paid by card', async () => {
  database=createDatabase(seed()); await place();
  Object.assign(database.state.orders[0],{payment_method:'pago_en_linea',order_status:'draft'});
  const body={id:orderId,action:'confirm',paymentMethod:'efectivo',status:'pendiente'};
  assert.equal((await confirm(request('POST',body))).statusCode,400);
  Object.assign(database.state.orders[0],{payment_status:'paid',order_status:'paid'});
  const response=await confirm(request('POST',body));
  assert.equal(response.statusCode,201,response.body);
  const order=JSON.parse(response.body).order;
  assert.equal(order.payment_method,'tarjeta'); assert.equal(order.status,'pagado');
});
test('confirmation requires an administrator', async () => {
  authError=true;
  assert.equal((await confirm(request('POST',{id:orderId,action:'confirm'}))).statusCode,401);
  authError=false;
});

async function captured() { database=createDatabase(seed());await place();const response=await confirm(request('POST',{id:orderId,action:'confirm',paymentMethod:'efectivo',status:'pagado'}));return JSON.parse(response.body).order; }
const editBody=(order) => ({id:order.id,action:'edit',expectedUpdatedAt:order.updated_at,customerName:'Cliente editado',customerPhone:'6141234567',orderType:'recoger',paymentMethod:'efectivo',status:'pagado',discountTotal:10,notes:'Editado',items:order.admin_order_items.map((item)=>({productId:item.product_id,productName:item.product_name,quantity:3,unitPrice:item.unit_price,selectedOptions:item.selected_options,itemNotes:item.item_notes}))});
test('ticket edits save without an extra reason dialog and return refreshed totals/items',async()=>{
  const order=await captured();const response=await edit(request('PATCH',editBody(order)));
  assert.equal(response.statusCode,200,response.body);
  const saved=JSON.parse(response.body).order;
  assert.equal(saved.customer_name,'Cliente editado');assert.equal(saved.total,440);
  assert.equal(saved.admin_order_items.length,1);assert.equal(saved.admin_order_items[0].quantity,3);
  assert.match(saved.admin_order_items[0].item_notes,/Sin: Cebolla/);
  assert.equal(database.state.order_edit_history.length,1);
  assert.equal(database.state.order_edit_history[0].edited_by,admin.displayName);
});
for(const failure of ['insert','header','delete']) test(`failed ticket ${failure} restores previous products and amounts`,async()=>{
  const order=await captured(),snapshot=structuredClone(database.state);
  let injected=false;
  const failed=createDatabase(snapshot,{fail:(query)=>{
    if(injected)return null;
    const match=failure==='insert'?query.table==='admin_order_items'&&query.action==='insert':failure==='header'?query.table==='admin_orders'&&query.action==='update':query.table==='admin_order_items'&&query.action==='delete';
    if(match){injected=true;return {message:'Injected write failure'};}return null;
  }});
  database=failed;
  const response=await edit(request('PATCH',editBody(order)));
  assert.equal(response.statusCode,500,response.body);
  assert.equal(database.state.admin_orders[0].total,order.total);
  assert.equal(database.state.admin_orders[0].customer_name,order.customer_name);
  assert.deepEqual(database.state.admin_order_items,snapshot.admin_order_items);
});
test('stale edits are rejected before altering the saved ticket',async()=>{
  const order=await captured();
  const response=await edit(request('PATCH',{...editBody(order),expectedUpdatedAt:'old-version'}));
  assert.equal(response.statusCode,409);assert.equal(database.state.admin_orders[0].total,300);
});
test('cancelling through the editor still saves the rest of the changes',async()=>{
  const order=await captured();
  const response=await edit(request('PATCH',{...editBody(order),status:'cancelado'}));
  assert.equal(response.statusCode,200,response.body);
  const saved=JSON.parse(response.body).order;
  assert.equal(saved.status,'cancelado');assert.equal(saved.total,440);assert.equal(saved.customer_name,'Cliente editado');
});
