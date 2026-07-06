import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// VITE_SUPABASE_ANON_KEY is safe in the browser only when RLS blocks public
// writes. Never expose SUPABASE_SERVICE_ROLE_KEY in Vite/frontend code.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

export async function listProductImages(productIds) {
  if (!isSupabaseConfigured || !productIds.length) return [];
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (!uniqueIds.length) return [];

  const { data, error } = await supabase
    .from('product_images')
    .select('id, product_id, image_url, storage_path, sort_order, created_at')
    .in('product_id', uniqueIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las imágenes de productos desde Supabase.');
  }
  return data || [];
}
