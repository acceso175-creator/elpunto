import { createClient } from '@supabase/supabase-js';

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

export function validateAdminPin(pin) {
  const expected = process.env.ADMIN_PIN;
  // MVP validation: replace this PIN check with Supabase Auth + an admin role in production.
  return Boolean(expected && pin && pin === expected);
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

function isOptionsSchemaCacheError(error) {
  return /options.*schema cache|schema cache.*options|Could not find.*options/i.test(error?.message || '');
}

async function productsSnapshot(supabase, includeUnavailable, includeOptions = true) {
  const fields = includeOptions
    ? 'id, category_id, name, description, price, cost, ingredient_cost, packaging_cost, discount_price, discount_active, price_label, available, favorite, badge, sort_order, options, product_ingredients(id, name, removable, sort_order), product_images(id, image_url, storage_path, sort_order)'
    : 'id, category_id, name, description, price, cost, ingredient_cost, packaging_cost, discount_price, discount_active, price_label, available, favorite, badge, sort_order, product_ingredients(id, name, removable, sort_order), product_images(id, image_url, storage_path, sort_order)';
  let productQuery = supabase
    .from('products')
    .select(fields)
    .order('sort_order', { ascending: true });
  if (!includeUnavailable) productQuery = productQuery.eq('available', true);
  return productQuery;
}

export async function menuSnapshot(supabase, includeUnavailable = true) {
  let categoryQuery = supabase
    .from('categories')
    .select('id, name, slug, sort_order, active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (!includeUnavailable) categoryQuery = categoryQuery.eq('active', true);

  const [{ data: categories, error: categoriesError }, productResult] = await Promise.all([
    categoryQuery,
    productsSnapshot(supabase, includeUnavailable)
  ]);
  if (categoriesError) throw new Error(categoriesError.message);
  if (!productResult.error) return { categories: categories || [], products: productResult.data || [] };
  if (!isOptionsSchemaCacheError(productResult.error)) throw new Error(productResult.error.message);

  const { data: products, error: productsError } = await productsSnapshot(supabase, includeUnavailable, false);
  if (productsError) throw new Error(productsError.message);
  return { categories: categories || [], products: products || [] };
}
