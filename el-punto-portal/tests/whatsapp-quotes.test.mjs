import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const source = await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
function functionSource(start,end) {
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.ok(from>=0&&to>from);
  return source.slice(from,to);
}
const buildMessageSource=functionSource('  function buildMessage(', '  async function startStripeCheckout(');
const sendSource=functionSource('  async function sendWhatsApp()', '\n  return (');
function messageContext(overrides={}) {
  return {cart:[{name:'Torta',price:95,quantity:1},{name:'Especial',price:null,quantity:1}],cartTotal:95,hasPriceConfirmation:true,orderType:'recoger',address:'',geoLink:'',notes:'',profile:{name:'Cliente',phone:''},payment:'efectivo',selectedPaymentLabel:'Efectivo',createOrderNumber:()=> 'EP-QUOTE',formatMoney:(value)=>'$'+Number(value).toFixed(2),selectedOptionsText:()=>'',calculateLine:(item)=>Number(item.price)||0,hasNumericPrice:(item)=>Number(item.price)>0,...overrides};
}
test('mixed carts identify unpriced lines and leave the total pending in WhatsApp',()=>{
  const message=vm.runInNewContext(buildMessageSource+'\nbuildMessage()',messageContext());
  assert.match(message,/Especial.*Precio por confirmar/);
  assert.match(message,/Total estimado: Por confirmar/);
  assert.doesNotMatch(message,/Total estimado: \$95/);
});
test('registered orders use the persisted names, line prices and total in WhatsApp',()=>{
  const context=messageContext({hasPriceConfirmation:false,saved:[{product_name:'Torta guardada',quantity:2,unit_price:150,line_total:300,selected_options:[],removed_ingredients:[]}],savedTotal:300});
  const message=vm.runInNewContext(buildMessageSource+"\nbuildMessage('EP-SAVED',saved,savedTotal)",context);
  assert.match(message,/Orden: EP-SAVED/);assert.match(message,/2 x Torta guardada/);assert.match(message,/Total estimado: \$300.00/);
});
test('unpriced WhatsApp orders open a quote without creating a zero-price sale',async()=>{
  const opened=[],notices=[];let fetches=0;
  const context={cart:[{name:'Especial',price:null,quantity:1}],sendingOrder:false,payment:'efectivo',orderType:'recoger',address:'',geoLink:'',business:{},businessWhatsappNumber:()=> '526140000000',hasPriceConfirmation:true,BUSINESS_WHATSAPP_URL:'https://wa.me/526140000000',buildMessage:()=> 'Cotización por confirmar',window:{open:(url)=>opened.push(url)},setWhatsappUrl(){},setOrderNotice:(text)=>notices.push(text),bumpMetric(){},fetch:()=>{fetches++;throw Error('Quote must not submit a payable order');}};
  await vm.runInNewContext(sendSource+'\nsendWhatsApp()',context);
  assert.equal(fetches,0);assert.equal(opened.length,1);assert.match(decodeURIComponent(opened[0]),/Cotización por confirmar/);assert.match(notices[0],/cotizar/);
});
test('a delivery quote still requires an address before opening WhatsApp',async()=>{
  let opened=false,notice='';
  const context={cart:[{price:null,quantity:1}],sendingOrder:false,payment:'efectivo',orderType:'domicilio',address:'',geoLink:'',window:{open:()=>{opened=true;}},setOrderNotice:(text)=>{notice=text;}};
  await vm.runInNewContext(sendSource+'\nsendWhatsApp()',context);
  assert.equal(opened,false);assert.match(notice,/dirección/);
});
