import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createDatabase } from './helpers/database.mjs';
import { salesDateRange } from '../src/lib/salesDates.js';
let database;
mock.module('../netlify/functions/_shared/requireAdmin.js', { namedExports: { requireAdmin: async () => ({ userId:'admin' }), isAuthError: () => false } });
mock.module('../netlify/functions/_supabaseAdmin.js', { namedExports: { getSupabaseAdmin: () => database, json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }) } });
const { handler } = await import('../netlify/functions/admin-sales-history.js');
const order = (id, fields={}) => ({id,created_at:'2026-11-25T16:00:00Z',status:'pagado',payment_method:'efectivo',order_type:'recoger',captured_by:'Andrés',total:100,...fields});
test('daily cut excludes next-day sales and preserves payment accounting',async()=>{
  database=createDatabase({admin_orders:[order('paid'),order('pending',{status:'pendiente'}),order('platform',{status:'pendiente',payment_method:'plataformas'}),order('canceled',{status:'cancelado'}),order('courtesy',{payment_method:'cortesia'}),order('next-day',{created_at:'2026-11-26T06:00:00Z'}),order('before',{created_at:'2026-11-25T05:59:59Z'})]});
  const response=await handler({httpMethod:'GET',queryStringParameters:salesDateRange('2026-11-25')});
  assert.equal(response.statusCode,200,response.body);
  const data=JSON.parse(response.body);
  assert.equal(data.orders.length,5);assert.equal(data.summary.salesTotal,200);assert.equal(data.summary.paymentsCollected,100);assert.equal(data.summary.platformPendingTotal,100);assert.equal(data.summary.cortesia,100);assert.equal(data.summary.canceledOrders,1);assert.equal(data.summary.pendingOrders,2);
});
test('cuts and history paginate instead of silently truncating large periods',async()=>{
  database=createDatabase({admin_orders:Array.from({length:1002},(_,i)=>order(`order-${String(i).padStart(4,'0')}`))});
  const response=await handler({httpMethod:'GET',queryStringParameters:salesDateRange('2026-11-25')});
  const data=JSON.parse(response.body);
  assert.equal(data.orders.length,1002);assert.equal(data.summary.salesTotal,100200);assert.equal(data.summary.paidOrders,1002);assert.equal(database.calls.filter((call)=>call.table==='admin_orders').length,3);
});
test('invalid query ranges are rejected without querying sales',async()=>{
  database=createDatabase();
  const response=await handler({httpMethod:'GET',queryStringParameters:{startDate:'invalid',endDate:'invalid'}});
  assert.equal(response.statusCode,400);assert.equal(database.calls.length,0);
});
