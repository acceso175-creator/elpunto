import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './helpers/database.mjs';
import { saveOrderEdit } from '../netlify/functions/_shared/orderEdits.js';

const previous = { id:'sale', customer_phone:'old phone', updated_at:'2026-11-25T10:00:00Z', total:100, status:'pagado', admin_order_items:[{id:'old-item',order_id:'sale',product_name:'Torta',quantity:1,unit_price:100,total_price:100}] };
const patch={total:200,status:'pagado'};
const items=[{product_name:'Torta',quantity:2,unit_price:100,total_price:200}];
function originalState(){const {admin_order_items,...order}=structuredClone(previous);return {admin_orders:[order],admin_order_items};}

test('recovery never overwrites a phone update committed after the edited header',async()=>{
  let injected=false,database;
  database=createDatabase(originalState(),{fail:(query)=>{
    if(!injected&&query.table==='admin_order_items'&&query.action==='delete'){
      injected=true;
      Object.assign(database.state.admin_orders[0],{customer_phone:'new phone',updated_at:'2026-11-25T19:00:00Z'});
      return {message:'Temporary delete failure'};
    }
    return null;
  }});
  await saveOrderEdit(database,previous,patch,items);
  assert.equal(database.state.admin_orders[0].customer_phone,'new phone');
  assert.equal(database.state.admin_orders[0].total,200);
  assert.equal(database.state.admin_order_items.length,1);
  assert.equal(database.state.admin_order_items[0].quantity,2);
});

test('recovery preserves a newer complete ticket edit and its replacement items',async()=>{
  let injected=false,database;
  database=createDatabase(originalState(),{fail:(query)=>{
    if(!injected&&query.table==='admin_order_items'&&query.action==='delete'){
      injected=true;
      Object.assign(database.state.admin_orders[0],{total:350,status:'pendiente',updated_at:'2026-11-25T19:00:00Z'});
      database.state.admin_order_items=[{id:'newer-item',order_id:'sale',product_name:'Nuevo pedido',quantity:1,unit_price:350,total_price:350}];
      return {message:'Temporary delete failure'};
    }
    return null;
  }});
  await saveOrderEdit(database,previous,patch,items);
  assert.equal(database.state.admin_orders[0].total,350);
  assert.equal(database.state.admin_orders[0].status,'pendiente');
  assert.equal(database.state.admin_order_items.length,1);
  assert.equal(database.state.admin_order_items[0].id,'newer-item');
});

test('an update arriving immediately before the forward version check rejects the stale edit',async()=>{
  let injected=false,database;
  database=createDatabase(originalState(),{fail:(query)=>{
    if(!injected&&query.table==='admin_orders'&&query.action==='update'){
      injected=true;
      Object.assign(database.state.admin_orders[0],{customer_phone:'new phone',updated_at:'2026-11-25T19:00:00Z'});
    }
    return null;
  }});
  await assert.rejects(saveOrderEdit(database,previous,patch,items),{statusCode:409});
  assert.equal(database.state.admin_orders[0].total,100);
  assert.equal(database.state.admin_orders[0].customer_phone,'new phone');
  assert.deepEqual(database.state.admin_order_items,previous.admin_order_items);
});
