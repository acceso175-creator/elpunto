const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// VITE_SUPABASE_ANON_KEY is safe to expose in the frontend only when RLS keeps
// public writes locked down. Never place SUPABASE_SERVICE_ROLE_KEY in Vite code.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra
  };
}

export async function listProductImages(productIds) {
  if (!isSupabaseConfigured || !productIds.length) return [];
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (!uniqueIds.length) return [];

  const ids = uniqueIds.join(',');
  const url = new URL(`${SUPABASE_URL}/rest/v1/product_images`);
  url.searchParams.set('select', 'id,product_id,image_url,storage_path,sort_order,created_at');
  url.searchParams.set('product_id', `in.(${ids})`);
  url.searchParams.set('order', 'sort_order.asc,created_at.asc');

  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) {
    throw new Error('No se pudieron cargar las imágenes de productos desde Supabase.');
  }
  return response.json();
}
