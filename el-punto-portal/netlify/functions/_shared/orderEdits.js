import { randomUUID } from 'node:crypto';

// Stage replacement items before removing the old ones. Any failed write
// restores the previous ticket instead of leaving an empty or half-edited sale.
export async function saveOrderEdit(supabase, previous, patch, items) {
  const originalItems = previous.admin_order_items || [];
  const replacements = items.map((item) => ({ ...item, id: randomUUID(), order_id: previous.id }));
  const inserted = await supabase.from('admin_order_items').insert(replacements);
  if (inserted.error) throw inserted.error;
  let headerChanged = false;
  let originalsDeleted = false;
  try {
    let update = supabase.from('admin_orders').update(patch).eq('id', previous.id);
    if (previous.updated_at) update = update.eq('updated_at', previous.updated_at);
    const updated = await update.select('id').maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) throw Object.assign(new Error('Otro usuario modificó el ticket. Actualiza la lista y vuelve a intentarlo.'), { statusCode: 409 });
    headerChanged = true;
    if (originalItems.length) {
      const removed = await supabase.from('admin_order_items').delete().in('id', originalItems.map((item) => item.id));
      if (removed.error) throw removed.error;
      originalsDeleted = true;
    }
  } catch (error) {
    const failures = [];
    if (originalsDeleted && originalItems.length) {
      const restored = await supabase.from('admin_order_items').upsert(originalItems);
      if (restored.error) failures.push(restored.error);
    }
    if (headerChanged) {
      const restored = await supabase.from('admin_orders').update(Object.fromEntries(Object.keys(patch).map((key) => [key, previous[key] ?? null]))).eq('id', previous.id);
      if (restored.error) failures.push(restored.error);
    }
    const cleaned = await supabase.from('admin_order_items').delete().in('id', replacements.map((item) => item.id));
    if (cleaned.error) failures.push(cleaned.error);
    if (failures.length) {
      console.error('[ticket edit recovery]', { orderId: previous.id, failures });
      throw new Error('No se completó la edición. Actualiza el ticket y revisa sus productos antes de volver a guardar.');
    }
    throw error;
  }
}
