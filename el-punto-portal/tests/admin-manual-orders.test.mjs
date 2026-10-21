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

function setup({ itemsError = null } = {}) {
  let savedOrder;
  let savedItems;
  let deletedId;
  database = {
    from(table) {
      if (table === 'admin_orders') return {
        insert(payload) {
          savedOrder = { ...payload, id: 'order-1', order_number: 'ADM-001' };
          return { select: () => ({ single: async () => ({ data: savedOrder, error: null }) }) };
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
  return { get order() { return savedOrder; }, get items() { return savedItems; }, get deletedId() { return deletedId; } };
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
});

test('item persistence failure rolls back the order and never returns a printable success', async () => {
  const saved = setup({ itemsError: { message: 'No se pudieron guardar los productos.' } });
  const response = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  assert.equal(response.statusCode, 500);
  assert.equal(saved.deletedId, saved.order.id);
  assert.deepEqual(JSON.parse(response.body), { error: 'No se pudieron guardar los productos.' });
});
