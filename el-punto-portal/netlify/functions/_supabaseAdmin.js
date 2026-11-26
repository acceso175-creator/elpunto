import { createClient } from '@supabase/supabase-js';
import { loadOptionCatalog } from './_shared/productOptions.js';

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
  const [ingredients, images, catalog] = await Promise.all([
    supabase.from('product_ingredients').select('id, product_id, name, removable, sort_order').in('product_id', productIds),
    supabase.from('product_images').select('id, product_id, image_url, storage_path, sort_order').in('product_id', productIds),
    loadOptionCatalog(supabase, productIds, { activeOnly: false })
  ]);
  if (ingredients.error) throw ingredients.error;
  if (images.error) throw images.error;
  return products.map((product) => ({
    ...product,
    product_ingredients: (ingredients.data || []).filter((row) => row.product_id === product.id),
    product_images: (images.data || []).filter((row) => row.product_id === product.id),
    option_groups_loaded: true,
    product_option_groups: catalog.groups.filter((group) => group.product_id === product.id).map((group) => ({ ...group, product_options: catalog.options.filter((option) => option.group_id === group.id) }))
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

