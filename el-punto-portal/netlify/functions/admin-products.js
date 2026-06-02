import { ensureCategory, getSupabaseAdmin, json, menuSnapshot, parseBody, slugify, validateAdminPin } from './_supabaseAdmin.js';

function isOptionsSchemaCacheError(error) {
  return /options.*schema cache|schema cache.*options|Could not find.*options/i.test(error?.message || '');
}

function normalizeProductOptions(options) {
  if (options === undefined || options === null) return {};
  if (Array.isArray(options)) return options;
  if (typeof options === 'object') return options;
  return {};
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanProductPayload(product, categoryId) {
  const priceNumber = optionalNumber(product.price);
  const costNumber = optionalNumber(product.cost);
  const discountPriceNumber = optionalNumber(product.discountPrice ?? product.discount_price);
  return {
    ...(product.supabaseProductId || product.id?.length === 36 ? { id: product.supabaseProductId || product.id } : {}),
    category_id: categoryId,
    name: String(product.name || '').trim(),
    description: product.description || '',
    price: Number.isFinite(priceNumber) ? priceNumber : null,
    cost: Number.isFinite(costNumber) ? costNumber : null,
    discount_price: Number.isFinite(discountPriceNumber) ? discountPriceNumber : null,
    discount_active: product.discountActive === true || product.discount_active === true,
    price_label: product.priceLabel || product.price_label || 'Precio por confirmar',
    available: product.available !== false,
    favorite: product.favorite === true,
    badge: product.badge || null,
    sort_order: Number(product.sortOrder ?? product.sort_order ?? 0),
    options: normalizeProductOptions(product.options),
    updated_at: new Date().toISOString()
  };
}

async function replaceIngredients(supabase, productId, ingredients = []) {
  const { error: deleteError } = await supabase.from('product_ingredients').delete().eq('product_id', productId);
  if (deleteError) throw new Error(deleteError.message);
  const rows = (Array.isArray(ingredients) ? ingredients : [])
    .map((ingredient, index) => typeof ingredient === 'string'
      ? { product_id: productId, name: ingredient.trim(), removable: true, sort_order: index }
      : { product_id: productId, name: String(ingredient?.name || '').trim(), removable: ingredient?.removable !== false, sort_order: Number(ingredient?.sortOrder ?? ingredient?.sort_order ?? index) })
    .filter((ingredient) => ingredient.name);
  if (!rows.length) return [];
  const { data, error } = await supabase.from('product_ingredients').insert(rows).select('id, name, removable, sort_order');
  if (error) throw new Error(error.message);
  return data || [];
}

async function findExistingProduct(supabase, name, categoryId) {
  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('category_id', categoryId)
    .ilike('name', name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function writeProduct(supabase, payload, includeOptions = true) {
  const writePayload = includeOptions ? payload : Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'options'));
  const fields = includeOptions
    ? 'id, category_id, name, description, price, cost, discount_price, discount_active, price_label, available, favorite, badge, sort_order, options'
    : 'id, category_id, name, description, price, cost, discount_price, discount_active, price_label, available, favorite, badge, sort_order';
  return supabase
    .from('products')
    .upsert(writePayload, { onConflict: 'id' })
    .select(fields)
    .single();
}

async function upsertProduct(supabase, product, category) {
  const savedCategory = await ensureCategory(supabase, category);
  const payload = cleanProductPayload(product, savedCategory.id);
  if (!payload.name) throw new Error('El producto necesita nombre.');
  const existing = payload.id ? null : await findExistingProduct(supabase, payload.name, savedCategory.id);
  if (existing?.id) payload.id = existing.id;

  let { data, error } = await writeProduct(supabase, payload);
  if (error && isOptionsSchemaCacheError(error)) {
    ({ data, error } = await writeProduct(supabase, payload, false));
  }
  if (error) throw new Error(error.message);
  const ingredients = await replaceIngredients(supabase, data.id, product.ingredients);
  return { ...data, product_ingredients: ingredients };
}

export async function handler(event) {
  try {
    const body = parseBody(event);
    const pin = body.adminPin || event.headers['x-admin-pin'];
    if (!validateAdminPin(pin)) return json(401, { error: 'PIN de admin inválido.' });
    const supabase = getSupabaseAdmin();

    if (event.httpMethod === 'GET') return json(200, await menuSnapshot(supabase));
    if (event.httpMethod === 'POST') {
      if (body.action === 'migrate') {
        const menu = Array.isArray(body.menu) ? body.menu : [];
        const products = [];
        for (const category of menu) {
          for (const item of category.items || []) {
            products.push(await upsertProduct(supabase, item, category));
          }
        }
        return json(200, { ok: true, count: products.length, ...(await menuSnapshot(supabase)) });
      }
      const product = await upsertProduct(supabase, body.product || body, body.category || { name: body.categoryName, slug: body.categorySlug || slugify(body.categoryName) });
      return json(200, { product, ...(await menuSnapshot(supabase)) });
    }
    if (event.httpMethod === 'PATCH') {
      const product = body.product || body;
      if (!product.id && !product.supabaseProductId) return json(400, { error: 'Falta id de producto.' });
      const category = body.category || { name: body.categoryName, slug: body.categorySlug };
      const saved = await upsertProduct(supabase, product, category);
      return json(200, { product: saved, ...(await menuSnapshot(supabase)) });
    }
    if (event.httpMethod === 'DELETE') {
      const productId = body.id || body.supabaseProductId;
      if (!productId) return json(400, { error: 'Falta id de producto.' });
      const { error } = await supabase.from('products').delete().eq('id', productId);
      if (error) throw new Error(error.message);
      return json(200, { ok: true, ...(await menuSnapshot(supabase)) });
    }
    return json(405, { error: 'Método no permitido.' });
  } catch (error) {
    return json(500, { error: error.message || 'Error inesperado en productos.' });
  }
}
