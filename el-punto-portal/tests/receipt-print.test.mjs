import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const script = await readFile(new URL('../public/receipt-print.js', import.meta.url), 'utf8');

function page(receipt) {
  let load;
  let printed = 0;
  let fontsReady;
  const frames = [];
  const elements = { print: { disabled: true, addEventListener(event, fn) { this.click = fn; } }, status: {}, ticket: {} };
  const window = { opener: {}, addEventListener(event, fn) { load = fn; }, print() { printed++; } };
  vm.runInNewContext(script, {
    window, location: { hash: '#elpunto_receipt_test' },
    sessionStorage: { getItem: () => JSON.stringify(receipt) },
    document: { getElementById: (id) => elements[id], images: [], fonts: { ready: new Promise((resolve) => { fontsReady = resolve; }) } },
    requestAnimationFrame: (fn) => frames.push(fn)
  });
  return { window, elements, load: () => load(), fontsReady: () => fontsReady(), frames, printed: () => printed };
}

test('prints only after content, fonts and layout are ready; retains ticket for reprint', async () => {
  const markup = `<div class="receipt-ticket">${'<p>Producto con observaciones</p>'.repeat(200)}<b>Total $500</b></div>`;
  const pageState = page({ title: 'Ticket 123', markup });
  const ready = pageState.load();
  assert.equal(pageState.window.opener, null);
  assert.equal(pageState.elements.ticket.innerHTML, markup);
  assert.equal(pageState.printed(), 0);
  assert.equal(pageState.elements.print.disabled, true);
  pageState.fontsReady();
  await new Promise(setImmediate);
  assert.equal(pageState.printed(), 0);
  pageState.frames.shift()();
  pageState.frames.shift()();
  await ready;
  assert.equal(pageState.printed(), 1);
  pageState.elements.print.click();
  assert.equal(pageState.printed(), 2);
  assert.equal(pageState.elements.ticket.innerHTML, markup);
});

test('missing receipt never starts a blank print job', async () => {
  const pageState = page(null);
  await pageState.load();
  assert.equal(pageState.printed(), 0);
  assert.equal(pageState.elements.print.disabled, true);
  assert.match(pageState.elements.status.textContent, /No se pudo cargar/);
});
