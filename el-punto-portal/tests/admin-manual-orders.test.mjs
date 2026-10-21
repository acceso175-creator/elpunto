// Run: node --experimental-test-module-mocks --test tests/admin-manual-orders.test.mjs
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const admin = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Andrés' };
let database;
mock.module('../netlify/functions/_shared/requireAdmin.js', {
  namedExports: { requireAdmin: async () => admin, isAuthError: () => false }
});
mock.module('../netlify/functions/_supabaseAdmin.js', {
  namedExports: {
    getSupabaseAdmin: () => database,
    parseBody: (event) => JSON.parse(event.body),
    json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) })
  }
});
const { handler } = await import('../netlify/functions/admin-manual-orders.js');

function setup({ itemsError = null, missingColumns = [], orderError = null } = {}) {
  let savedOrder;
  let savedItems;
  let deletedId;
  const attempts = [];
  let persistedOrders = 0;
  database = {
    from(table) {
      if (table === 'admin_orders') return {
        insert(payload) {
          attempts.push({ ...payload });
          return { select: () => ({ single: async () => {
            const column = missingColumns.find((name) => Object.hasOwn(payload, name));
            if (column) return { data: null, error: {
              code: 'PGRST204', message: `Could not find the '${column}' column of 'admin_orders' in the schema cache`
            } };
            if (orderError) return { data: null, error: orderError };
            savedOrder = { ...payload, id: 'order-1', order_number: 'ADM-001' };
            persistedOrders += 1;
            return { data: savedOrder, error: null };
          } }) };
        },
        delete: () => ({ eq: async (_, id) => { deletedId = id; return { error: null }; } })
      };
      assert.equal(table, 'admin_order_items');
      return {
        insert(items) {
          savedItems = items.map((item, i) => ({ ...item, id: `item-${i}` }));
          return { select: async () => ({ data: itemsError ? null : savedItems, error: itemsError }) };
        }
      };
    }
  };
  return { attempts, get persistedOrders() { return persistedOrders; }, get order() { return savedOrder; }, get items() { return savedItems; }, get deletedId() { return deletedId; } };
}

const body = {
  orderType: 'mostrador', paymentMethod: 'efectivo', status: 'pagado',
  items: [{ productName: 'Chilaquiles', quantity: 2, unitPrice: 75,
    selectedOptions: [{ name: 'Chipotle', priceDelta: 0 }], itemNotes: 'Sin cebolla' }]
};

test('saved order includes persisted receipt items, amounts, options and capture identity', async () => {
  const saved = setup();
  const response = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  assert.equal(response.statusCode, 201);
  const { order } = JSON.parse(response.body);
  assert.deepEqual(order.admin_order_items, saved.items);
  assert.equal(order.admin_order_items[0].order_id, order.id);
  assert.equal(order.admin_order_items[0].product_name, 'Chilaquiles');
  assert.equal(order.admin_order_items[0].total_price, 150);
  assert.deepEqual(order.admin_order_items[0].selected_options, body.items[0].selectedOptions);
  assert.equal(order.admin_order_items[0].item_notes, 'Sin cebolla');
  assert.equal(order.total, 150);
  assert.equal(order.captured_by_name, admin.displayName);
  assert.equal(order.captured_by_user_id, admin.userId);
  assert.equal(saved.attempts.length, 1);
  assert.equal(saved.persistedOrders, 1);
});

for (const missingColumns of [
  ['captured_by_name'],
  ['captured_by_user_id'],
  ['captured_by_name', 'captured_by_user_id'],
  ['captured_by_user_id', 'captured_by_name']
]) {
  test(`legacy schema saves one printable order with missing ${missingColumns.join(', ')}`, async () => {
    const saved = setup({ missingColumns });
    const response = await handler({ httpMethod: 'POST', body: JSON.stringify({
      ...body, capturedBy: 'Nombre falsificado', captured_by_name: 'Nombre falsificado'
    }) });
    assert.equal(response.statusCode, 201);
    const { order } = JSON.parse(response.body);
    assert.equal(order.captured_by, admin.displayName);
    assert.equal(order.updated_by, admin.displayName);
    assert.equal(saved.persistedOrders, 1);
    assert.equal(saved.attempts.length, missingColumns.length + 1);
    assert.equal(order.total, 150);
    assert.deepEqual(order.admin_order_items, saved.items);
    assert.equal(order.admin_order_items[0].product_name, 'Chilaquiles');
    assert.equal(order.admin_order_items[0].item_notes, 'Sin cebolla');
    for (const field of ['captured_by_name', 'captured_by_user_id']) {
      if (missingColumns.includes(field)) assert.equal(Object.hasOwn(order, field), false);
      else assert.equal(order[field], field === 'captured_by_name' ? admin.displayName : admin.userId);
    }
  });
}

for (const orderError of [
  { code: 'PGRST204', message: "Could not find the 'total' column of 'admin_orders' in the schema cache" },
  { code: 'PGRST204', message: "Could not find the 'captured_by_name' column of 'other_table' in the schema cache" },
  { code: '23503', message: 'Foreign key violation' },
  { code: '42501', message: 'Permission denied' },
  { code: 'PGRST000', message: 'Connection failed' },
  { code: '42703', message: 'column captured_by_name does not exist' }
]) {
  test(`does not retry unrelated error: ${orderError.code} ${orderError.message}`, async () => {
    const saved = setup({ orderError });
    const response = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), { error: orderError.message });
    assert.equal(saved.attempts.length, 1);
    assert.equal(saved.persistedOrders, 0);
    assert.equal(saved.items, undefined);
  });
}

test('item persistence failure rolls back the order and never returns a printable success', async () => {
  const saved = setup({ itemsError: { message: 'No se pudieron guardar los productos.' } });
  const response = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  assert.equal(response.statusCode, 500);
  assert.equal(saved.deletedId, saved.order.id);
  assert.deepEqual(JSON.parse(response.body), { error: 'No se pudieron guardar los productos.' });
});
