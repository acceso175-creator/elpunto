import { loadOptionCatalog } from './productOptions.js';

export const money = (value) => Math.round(Number(value) * 100) / 100;
export const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
export function badRequest(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }

export function priceOptions(groups, options, selections = []) {
  if (!Array.isArray(selections)) throw badRequest('Actualiza el carrito para volver a elegir las opciones del producto.');
  const ids = selections.map((option) => option.optionId);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw badRequest('Hay opciones inválidas o repetidas en el carrito.');
  const remaining = new Set(ids);
  const canonical = [];
  for (const group of groups) {
    const available = options.filter((option) => option.group_id === group.id && option.is_active !== false);
    if (!available.length) continue;
    const selected = available.filter((option) => remaining.has(option.id));
    const min = Math.max(group.required ? 1 : 0, Number(group.min_select) || 0);
    const max = group.selection_type === 'multiple' ? Math.max(1, min, Number(group.max_select) || 1) : 1;
    if (((group.required || selected.length) && selected.length < min) || selected.length > max) throw badRequest(`Revisa la selección de ${group.name}.`);
    for (const option of selected) {
      remaining.delete(option.id);
      canonical.push({ groupId: group.id, groupName: group.name, optionId: option.id, name: option.name, priceDelta: Number(option.price_delta || 0), templateId: option.template_id || null });
    }
  }
  if (remaining.size) throw badRequest('Una opción seleccionada ya no está disponible. Actualiza el carrito.');
  return { selections: canonical, extra: money(canonical.reduce((sum, option) => sum + option.priceDelta, 0)) };
}

export async function pricePortalCart(supabase, cart) {
  if (!Array.isArray(cart) || !cart.length || cart.length > 100) throw badRequest('El carrito debe contener entre 1 y 100 productos.');
  const clean = cart.map((item) => {
    const productId = item?.supabaseProductId || item?.productId || item?.id;
    const quantity = Number(item?.quantity);
    if (!isUuid(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw badRequest('Producto o cantidad inválidos. Actualiza el carrito.');
    return { ...item, productId, quantity };
  });
  const ids = [...new Set(clean.map((item) => item.productId))];
  const [productsResult, ingredientsResult, catalog] = await Promise.all([
    supabase.from('products').select('*').in('id', ids),
    supabase.from('product_ingredients').select('product_id, name, removable').in('product_id', ids),
    loadOptionCatalog(supabase, ids)
  ]);
  if (productsResult.error) throw productsResult.error;
  if (ingredientsResult.error) throw ingredientsResult.error;
  const products = new Map((productsResult.data || []).map((product) => [product.id, product]));
  return clean.map((item) => {
    const product = products.get(item.productId);
    if (!product || product.available === false) throw badRequest('Un producto ya no está disponible. Actualiza el carrito.');
    const regular = Number(product.price), discounted = Number(product.discount_price);
    const discountedActive = [true, 'true', 1].includes(product.discount_active) && discounted > 0 && discounted < regular;
    const base = discountedActive ? discounted : regular;
    if (!Number.isFinite(base) || base <= 0) throw badRequest('Un producto necesita confirmar su precio antes de enviar el pedido.');
    const groups = catalog.groups.filter((group) => group.product_id === product.id);
    const selectedOptions = item.selectedOptions || [];
    let priced;
    if (!Array.isArray(selectedOptions) && !groups.length) {
      const definitions = Array.isArray(product.options) ? product.options : [];
      for (const [name, value] of Object.entries(selectedOptions)) if (!definitions.some((definition) => definition.name === name && definition.values?.includes(value))) throw badRequest('Opción del producto inválida.');
      priced = { extra: Object.values(selectedOptions).some((value) => String(value).includes('+$25')) ? 25 : 0, selections: selectedOptions };
    } else priced = priceOptions(groups, catalog.options, Array.isArray(selectedOptions) ? selectedOptions : []);
    const allowed = new Set((ingredientsResult.data || []).filter((ingredient) => ingredient.product_id === product.id && ingredient.removable !== false).map((ingredient) => ingredient.name));
    const removed = Array.isArray(item.removedIngredients) ? [...new Set(item.removedIngredients)] : [];
    if (removed.some((name) => !allowed.has(name))) throw badRequest('Un ingrediente seleccionado no se puede quitar. Actualiza el carrito.');
    const unitPrice = money(base + priced.extra);
    const cost = product.cost == null ? null : Number(product.cost);
    return { product_id: product.id, product_name: product.name, quantity: item.quantity, unit_price: unitPrice, original_price: regular, discount_price: discountedActive ? discounted : null, effective_price: base, cost: Number.isFinite(cost) ? cost : null, line_profit: Number.isFinite(cost) ? money((unitPrice - cost) * item.quantity) : null, line_total: money(unitPrice * item.quantity), selected_options: priced.selections, removed_ingredients: removed, notes: String(item.notes || '').slice(0,1000) };
  });
}
