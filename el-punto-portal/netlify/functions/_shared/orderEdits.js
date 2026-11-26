import { randomUUID } from 'node:crypto';

export async function saveOrderEdit(supabase, previous, patch, items) {
  const originalItems = previous.admin_order_items || [];
  const replacements = items.map((item) => ({ ...item, id: randomUUID(), order_id: previous.id }));
  const inserted = await supabase.from('admin_order_items').insert(replacements);
  if (inserted.error) throw inserted.error;
  let writtenVersion = null;
  const removeOriginals = () => originalItems.length
    ? supabase.from('admin_order_items').delete().in('id', originalItems.map((item) => item.id))
    : Promise.resolve({ error: null });
  try {
    let update = supabase.from('admin_orders').update(patch).eq('id', previous.id);
    if (previous.updated_at) update = update.eq('updated_at', previous.updated_at);
    const updated = await update.select('id, updated_at').maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) throw Object.assign(new Error('Otro usuario modificó el ticket. Actualiza la lista y vuelve a intentarlo.'), { statusCode: 409 });
    writtenVersion = updated.data.updated_at;
    const removed = await removeOriginals();
    if (removed.error) throw removed.error;
  } catch (error) {
    if (writtenVersion) {
      // Recovery must obey the same version check as the forward write.
      // Never restore an old header over a newer administrator's changes.
      const restored = await supabase.from('admin_orders')
        .update(Object.fromEntries(Object.keys(patch).map((key) => [key, previous[key] ?? null])))
        .eq('id', previous.id).eq('updated_at', writtenVersion).select('id').maybeSingle();
      if (restored.error) {
        console.error('[ticket edit recovery]', { orderId: previous.id, error: restored.error });
        throw new Error('No se completó la recuperación. Actualiza el ticket y revisa sus productos antes de volver a guardar.');
      }
      if (!restored.data) {
        // The header has a newer version. Keep it and finish only our pending
        // removal. A later full edit may already have removed these item IDs.
        const finalized = await removeOriginals();
        if (finalized.error) {
          console.error('[ticket concurrent recovery]', { orderId: previous.id, error: finalized.error });
          throw new Error('Otro usuario actualizó el ticket durante la edición. Actualiza y revisa sus productos antes de continuar.');
        }
        return;
      }
    }
    const cleaned = await supabase.from('admin_order_items').delete().in('id', replacements.map((item) => item.id));
    if (cleaned.error) {
      console.error('[ticket edit cleanup]', { orderId: previous.id, error: cleaned.error });
      throw new Error('No se completó la edición. Actualiza el ticket y revisa sus productos antes de volver a guardar.');
    }
    throw error;
  }
}
