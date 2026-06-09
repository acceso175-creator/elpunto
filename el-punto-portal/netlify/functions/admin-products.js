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

function booleanValue(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function cleanProductPayload(product, categoryId) {
  const priceNumber = optionalNumber(product.price);
  const costNumber = optionalNumber(product.cost);
  const ingredientCostNumber = optionalNumber(product.ingredientCost ?? product.ingredient_cost);
  const packagingCostNumber = optionalNumber(product.packagingCost ?? product.packaging_cost);
  const discountPriceNumber = optionalNumber(product.discountPrice ?? product.discount_price);
  return {
    ...(product.supabaseProductId || product.id?.length === 36 ? { id: product.supabaseProductId || product.id } : {}),
    category_id: categoryId,
    name: String(product.name || '').trim(),
    description: product.description || '',
    price: Number.isFinite(priceNumber) ? priceNumber : null,
    cost: Number.isFinite(costNumber) ? costNumber : null,
    ingredient_cost: Number.isFinite(ingredientCostNumber) ? ingredientCostNumber : null,
    packaging_cost: Number.isFinite(packagingCostNumber) ? packagingCostNumber : null,
    discount_price: Number.isFinite(discountPriceNumber) ? discountPriceNumber : null,
    discount_active: booleanValue(product.discount_active ?? product.discountActive),
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

async function replaceOptionGroups(supabase, productId, groups = []) {
  const cleanGroups = (Array.isArray(groups) ? groups : []).map((group, index) => {
    const name = String(group?.name || '').trim();
    if (!name) throw new Error('No se puede guardar un grupo de opciones sin nombre.');
    const selectionType = group.selectionType === 'multiple' || group.selection_type === 'multiple' ? 'multiple' : 'single';
    const required = booleanValue(group.required);
    const requestedMin = Number(group.minSelect ?? group.min_select ?? 0);
    const requestedMax = Number(group.maxSelect ?? group.max_select ?? 1);
    const minSelect = Math.max(required ? 1 : 0, Number.isFinite(requestedMin) ? requestedMin : 0);
    const maxSelect = selectionType === 'single' ? 1 : Math.max(1, minSelect, Number.isFinite(requestedMax) ? requestedMax : 1);
    const options = (Array.isArray(group.options) ? group.options : []).map((option, optionIndex) => {
      const optionName = String(option?.name || '').trim();
      if (!optionName) throw new Error(`No se puede guardar una opción sin nombre en ${name}.`);
      return { name: optionName, price_delta: Number(option.priceDelta ?? option.price_delta ?? 0) || 0, is_active: option.isActive !== false && option.is_active !== false, sort_order: Number(option.sortOrder ?? option.sort_order ?? optionIndex) };
    });
    return { row: { product_id: productId, name, required, selection_type: selectionType, min_select: minSelect, max_select: maxSelect, sort_order: Number(group.sortOrder ?? group.sort_order ?? index), is_active: group.isActive !== false && group.is_active !== false }, options };
  });
  const { error: deleteError } = await supabase.from('product_option_groups').delete().eq('product_id', productId);
  if (deleteError) throw new Error(deleteError.message);
  for (const group of cleanGroups) {
    const { data, error } = await supabase.from('product_option_groups').insert(group.row).select('id').single();
    if (error) throw new Error(error.message);
    if (group.options.length) {
      const { error: optionsError } = await supabase.from('product_options').insert(group.options.map((option) => ({ ...option, group_id: data.id })));
      if (optionsError) throw new Error(optionsError.message);
    }
  }
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
    ? 'id, category_id, name, description, price, cost, ingredient_cost, packaging_cost, discount_price, discount_active, price_label, available, favorite, badge, sort_order, options'
    : 'id, category_id, name, description, price, cost, ingredient_cost, packaging_cost, discount_price, discount_active, price_label, available, favorite, badge, sort_order';
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
  if (product.optionGroupsLoaded !== false && Array.isArray(product.optionGroups)) await replaceOptionGroups(supabase, data.id, product.optionGroups);
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
