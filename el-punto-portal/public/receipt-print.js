async function prepareReceipt() {
  const button = document.getElementById('print');
  const status = document.getElementById('status');
  // Session storage was copied when the tab opened. Detach the admin window;
  // this document has no dependency on its DOM or lifetime.
  window.opener = null;
  try {
    const key = location.hash.slice(1);
    if (!/^elpunto_receipt_[\w-]+$/.test(key)) throw new Error('missing receipt');
    const receipt = JSON.parse(sessionStorage.getItem(key));
    if (!receipt?.markup) throw new Error('missing receipt');
    document.title = receipt.title;
    document.getElementById('ticket').innerHTML = receipt.markup;
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    button.disabled = false;
    status.textContent = 'Ticket listo. Puedes volver a imprimir desde esta página.';
    button.addEventListener('click', () => window.print());
    // Leave this tab and its document alive after printing/cancelling. Android
    // services can consume the job asynchronously; no timer or afterprint cleanup.
    window.print();
  } catch {
    status.textContent = 'No se pudo cargar el ticket. Vuelve al pedido y pulsa Imprimir ticket.';
  }
}

window.addEventListener('load', prepareReceipt, { once: true });
