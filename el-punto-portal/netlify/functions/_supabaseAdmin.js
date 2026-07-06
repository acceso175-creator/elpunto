import { createClient } from '@supabase/supabase-js';

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export function supabaseErrorDetails(error) {
  return { message: error?.message || null, code: error?.code || null, details: error?.details || null, hint: error?.hint || null };
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}


export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Netlify.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

export async function ensureCategory(supabase, category) {
  const cleanName = String(category?.name || category?.category || category || '').trim() || 'Menú';
  const slug = category?.slug || category?.id || slugify(cleanName);
  const sortOrderValue = category?.sortOrder ?? category?.sort_order;
  const payload = {
    id: category?.supabaseCategoryId || category?.uuid || undefined,
    name: cleanName,
    slug,
    ...(sortOrderValue !== undefined ? { sort_order: Number(sortOrderValue) } : {}),
    active: category?.active !== false
  };
  const { data, error } = await supabase
    .from('categories')
    .upsert(payload, { onConflict: 'slug' })
    .select('id, name, slug, sort_order, active')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function loadProductRelations(supabase, products) {
  const productIds = products.map((product) => product.id).filter(Boolean);
  if (!productIds.length) return products;
  const [ingredientsResult, imagesResult, groupsResult] = await Promise.all([
    supabase.from('product_ingredients').select('id, product_id, name, removable, sort_order').in('product_id', productIds),
    supabase.from('product_images').select('id, product_id, image_url, storage_path, sort_order').in('product_id', productIds),
    supabase.from('product_option_groups').select('id, product_id, name, required, selection_type, min_select, max_select, sort_order, is_active').in('product_id', productIds).order('sort_order', { ascending: true })
  ]);
  const groups = groupsResult.error ? [] : groupsResult.data || [];
  const groupIds = groups.map((group) => group.id);
  const optionsResult = groupIds.length
    ? await supabase.from('product_options').select('id, group_id, name, price_delta, is_active, sort_order').in('group_id', groupIds).order('sort_order', { ascending: true })
    : { data: [], error: null };
  if (ingredientsResult.error) console.error('[admin products] product_ingredients', supabaseErrorDetails(ingredientsResult.error));
  if (imagesResult.error) console.error('[admin products] product_images', supabaseErrorDetails(imagesResult.error));
  if (groupsResult.error) console.error('[admin products] product_option_groups', supabaseErrorDetails(groupsResult.error));
  if (optionsResult.error) console.error('[admin products] product_options', supabaseErrorDetails(optionsResult.error));
  const byProduct = (rows) => rows.reduce((map, row) => map.set(row.product_id, [...(map.get(row.product_id) || []), row]), new Map());
  const ingredientsByProduct = byProduct(ingredientsResult.error ? [] : ingredientsResult.data || []);
  const imagesByProduct = byProduct(imagesResult.error ? [] : imagesResult.data || []);
  const groupsByProduct = byProduct(groupsResult.error || optionsResult.error ? [] : groups);
  const optionsByGroup = new Map();
  (groupsResult.error || optionsResult.error ? [] : optionsResult.data || []).forEach((option) => optionsByGroup.set(option.group_id, [...(optionsByGroup.get(option.group_id) || []), option]));
  return products.map((product) => ({
    ...product,
    product_ingredients: ingredientsByProduct.get(product.id) || [],
    product_images: imagesByProduct.get(product.id) || [],
    option_groups_loaded: !groupsResult.error && !optionsResult.error,
    product_option_groups: (groupsByProduct.get(product.id) || []).map((group) => ({ ...group, product_options: optionsByGroup.get(group.id) || [] }))
  }));
}

async function productsSnapshot(supabase) {
  return supabase
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true });
}

export async function menuSnapshot(supabase, includeUnavailable = true) {
  let categoryQuery = supabase
    .from('categories')
    .select('id, name, slug, sort_order, active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (!includeUnavailable) categoryQuery = categoryQuery.eq('active', true);
  const [{ data: categories, error: categoriesError }, { data: products, error: productsError }] = await Promise.all([categoryQuery, productsSnapshot(supabase)]);
  if (categoriesError) throw new Error(categoriesError.message);
  if (productsError) throw new Error(productsError.message);
  return { categories: categories || [], products: await loadProductRelations(supabase, products || []) };
}
