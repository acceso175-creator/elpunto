import { BUSINESS_WHATSAPP } from '../businessConfig.js';
import { businessDefaults, initialMenu } from '../menuData.js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

const categoryDescriptions = {
  desayunos: 'Clásicos para arrancar el día.',
  birria: 'Opciones con cebolla, cilantro, limón y salsa.',
  bebidas: 'Café, jugos, malteadas y smoothies.',
  postres: 'Algo dulce para cerrar tu pedido.'
};

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function localWarning(reason) {
  console.warn(`[El Punto] Supabase no disponible; usando menú local. ${reason || ''}`.trim());
}

function normalizeIngredient(ingredient, index = 0) {
  if (typeof ingredient === 'string') {
    return { id: `${slugify(ingredient)}-${index}`, name: ingredient, removable: true, sortOrder: index };
  }
  return {
    id: ingredient?.id || `${slugify(ingredient?.name)}-${index}`,
    name: String(ingredient?.name || '').trim(),
    removable: ingredient?.removable !== false,
    sortOrder: Number(ingredient?.sort_order ?? ingredient?.sortOrder ?? index)
  };
}

function normalizeProductOption(option, index = 0) {
  return {
    id: option.id,
    groupId: option.group_id || option.groupId,
    name: String(option.name || '').trim(),
    priceDelta: Number(option.price_delta ?? option.priceDelta ?? 0),
    isActive: option.is_active !== false,
    sortOrder: Number(option.sort_order ?? option.sortOrder ?? index)
  };
}

function normalizeOptionGroup(group, index = 0) {
  const selectionType = group.selection_type === 'multiple' || group.selectionType === 'multiple' ? 'multiple' : 'single';
  const required = group.required === true;
  const minSelect = Math.max(required ? 1 : 0, Number(group.min_select ?? group.minSelect ?? 0));
  return {
    id: group.id,
    productId: group.product_id || group.productId,
    name: String(group.name || '').trim(),
    required,
    selectionType,
    minSelect,
    maxSelect: selectionType === 'single' ? 1 : Math.max(1, minSelect, Number(group.max_select ?? group.maxSelect ?? 1) || 1),
    isActive: group.is_active !== false,
    sortOrder: Number(group.sort_order ?? group.sortOrder ?? index),
    options: (group.product_options || group.options || []).map(normalizeProductOption).filter((option) => option.name).sort((a, b) => a.sortOrder - b.sortOrder)
  };
}

function normalizeImage(image, index = 0) {
  return {
    id: image.id,
    imageUrl: image.image_url || image.imageUrl,
    image_url: image.image_url || image.imageUrl,
    storagePath: image.storage_path || image.storagePath || '',
    storage_path: image.storage_path || image.storagePath || '',
    sortOrder: Number(image.sort_order ?? image.sortOrder ?? index)
  };
}

function normalizeBusinessSettings(row) {
  if (!row) return businessDefaults;
  return {
    ...businessDefaults,
    id: row.id,
    name: row.business_name || businessDefaults.name,
    subtitle: row.subtitle || businessDefaults.subtitle,
    whatsapp: BUSINESS_WHATSAPP,
    googleMapsUrl: row.google_maps_url || businessDefaults.googleMapsUrl,
    cryptoBtcWallet: row.crypto_btc_wallet || '',
    cryptoEthWallet: row.crypto_eth_wallet || '',
    cryptoUsdtTrc20Wallet: row.crypto_usdt_trc20_wallet || '',
    cryptoNote: row.crypto_note || '',
    cryptoWallets: [
      row.crypto_btc_wallet && `BTC: ${row.crypto_btc_wallet}`,
      row.crypto_eth_wallet && `ETH: ${row.crypto_eth_wallet}`,
      row.crypto_usdt_trc20_wallet && `USDT TRC20: ${row.crypto_usdt_trc20_wallet}`,
      row.crypto_note
    ].filter(Boolean)
  };
}

function productFromRow(row, category, index = 0) {
  const categorySlug = category?.slug || slugify(category?.name || row.category || 'menu');
  const price = row.price === null || row.price === undefined ? null : Number(row.price);
  const discountPrice = row.discount_price === null || row.discount_price === undefined ? null : Number(row.discount_price);
  return {
    id: row.id,
    supabaseProductId: row.id,
    isSupabaseProduct: true,
    name: row.name,
    description: row.description || '',
    category: category?.name || row.category_name || '',
    categorySlug,
    cost: row.cost === null || row.cost === undefined ? null : Number(row.cost),
    ingredientCost: row.ingredient_cost === null || row.ingredient_cost === undefined ? null : Number(row.ingredient_cost),
    packagingCost: row.packaging_cost === null || row.packaging_cost === undefined ? null : Number(row.packaging_cost),
    price,
    discountPrice,
    discountActive: row.discount_active === true,
    priceLabel: row.price_label || (price ? undefined : 'Precio por confirmar'),
    available: row.available !== false,
    favorite: row.favorite === true,
    badge: row.badge || '',
    sortOrder: Number(row.sort_order ?? index),
    options: Array.isArray(row.options) ? row.options : [],
    optionGroupsLoaded: row.option_groups_loaded !== false,
    optionGroups: (row.product_option_groups || []).map(normalizeOptionGroup).filter((group) => group.name).sort((a, b) => a.sortOrder - b.sortOrder),
    ingredients: (row.product_ingredients || [])
      .map(normalizeIngredient)
      .filter((ingredient) => ingredient.name)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    images: (row.product_images || [])
      .map(normalizeImage)
      .filter((image) => image.imageUrl)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  };
}

function effectiveProductRowPrice(product) {
  const price = Number(product?.price);
  const discountPrice = Number(product?.discount_price);
  const discountActive = product?.discount_active === true || product?.discount_active === 'true' || product?.discount_active === 1;
  if (discountActive && Number.isFinite(discountPrice) && discountPrice > 0 && Number.isFinite(price) && discountPrice < price) return discountPrice;
  return Number.isFinite(price) && price > 0 ? price : null;
}

function menuFromRows(categories, products, sortProductsByPrice = false) {
  return categories.map((category) => ({
    id: category.slug,
    supabaseCategoryId: category.id,
    name: category.name,
    description: categoryDescriptions[category.slug] || 'Categoría editable desde Admin.',
    sortOrder: Number(category.sort_order || 0),
    active: category.active !== false,
    items: products
      .filter((product) => product.category_id === category.id)
      .sort((a, b) => {
        if (!sortProductsByPrice) return Number(a.sort_order || 0) - Number(b.sort_order || 0);
        const priceA = effectiveProductRowPrice(a);
        const priceB = effectiveProductRowPrice(b);
        if (priceA === null && priceB === null) return Number(a.sort_order || 0) - Number(b.sort_order || 0);
        if (priceA === null) return 1;
        if (priceB === null) return -1;
        return priceB - priceA || Number(a.sort_order || 0) - Number(b.sort_order || 0);
      })
      .map((product, index) => productFromRow(product, category, index))
  })).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name)));
}

export function normalizeMenuData(categories, products) {
  return menuFromRows(categories || [], products || []);
}

export async function getCategories() {
  if (!isSupabaseConfigured) {
    localWarning('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.');
    return initialMenu.map((category, index) => ({ id: category.id, name: category.name, slug: category.id, sort_order: index, active: true }));
  }
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, sort_order, active, created_at, updated_at')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getProducts() {
  if (!isSupabaseConfigured) {
    localWarning('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.');
    return initialMenu.flatMap((category) => category.items.map((item) => ({ ...item, category_id: category.id })));
  }
  let { data, error } = await supabase.from('products').select('*').eq('available', true).order('sort_order', { ascending: true });
  if (error && /column.*available.*does not exist/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('products').select('*').order('sort_order', { ascending: true }));
  }
  if (error) throw new Error(error.message);
  return data || [];
}

async function getPublicProductRelations(products) {
  const productIds = products.map((product) => product.id).filter(Boolean);
  if (!productIds.length) return products;

  const [ingredientsResult, imagesResult, groupsResult] = await Promise.all([
    supabase.from('product_ingredients').select('id, product_id, name, removable, sort_order').in('product_id', productIds),
    supabase.from('product_images').select('id, product_id, image_url, storage_path, sort_order').in('product_id', productIds),
    supabase.from('product_option_groups').select('id, product_id, name, required, selection_type, min_select, max_select, sort_order, is_active').in('product_id', productIds).eq('is_active', true).order('sort_order', { ascending: true })
  ]);
  const groups = groupsResult.error ? [] : groupsResult.data || [];
  const groupIds = groups.map((group) => group.id);
  const optionsResult = groupIds.length
    ? await supabase.from('product_options').select('id, group_id, name, price_delta, is_active, sort_order').in('group_id', groupIds).eq('is_active', true).order('sort_order', { ascending: true })
    : { data: [], error: null };

  const logSupabaseError = (table, error) => console.error(`[El Punto] Error cargando ${table}`, { message: error?.message, code: error?.code, details: error?.details, hint: error?.hint });
  if (ingredientsResult.error) logSupabaseError('product_ingredients', ingredientsResult.error);
  if (imagesResult.error) logSupabaseError('product_images', imagesResult.error);
  if (groupsResult.error) logSupabaseError('product_option_groups', groupsResult.error);
  if (optionsResult.error) logSupabaseError('product_options', optionsResult.error);

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
    product_option_groups: (groupsByProduct.get(product.id) || []).map((group) => ({ ...group, product_options: optionsByGroup.get(group.id) || [] }))
  }));
}

export async function getProductIngredients(productId) {
  if (!isSupabaseConfigured || !productId) return [];
  const { data, error } = await supabase
    .from('product_ingredients')
    .select('id, name, removable, sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeIngredient);
}

export async function getProductImages(productId) {
  if (!isSupabaseConfigured || !productId) return [];
  const { data, error } = await supabase
    .from('product_images')
    .select('id, image_url, storage_path, sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeImage);
}

export async function getBusinessSettings() {
  if (!isSupabaseConfigured) {
    localWarning('Faltan variables públicas de Supabase.');
    return businessDefaults;
  }
  const { data, error } = await supabase
    .from('business_settings')
    .select('id, business_name, subtitle, whatsapp_number, google_maps_url, crypto_btc_wallet, crypto_eth_wallet, crypto_usdt_trc20_wallet, crypto_note')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeBusinessSettings(data);
}

export async function getMenuData() {
  if (!isSupabaseConfigured) {
    localWarning('Faltan variables públicas de Supabase.');
    return { menu: initialMenu, business: businessDefaults, source: 'local' };
  }
  try {
    const [categories, products, business] = await Promise.all([getCategories(), getProducts(), getBusinessSettings()]);
    const productsWithRelations = await getPublicProductRelations(products);
    return { menu: menuFromRows(categories, productsWithRelations, true), business, source: 'supabase' };
  } catch (error) {
    console.error('[El Punto] No se pudo cargar el menú real desde Supabase.', error.message);
    return { menu: [], business: businessDefaults, source: 'supabase', error };
  }
}
