import { loadOptionCatalog } from './_shared/productOptions.js';
import { getSupabaseAdmin, json, supabaseErrorDetails } from './_supabaseAdmin.js';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido.' });
  try {
    const ids = String(event.queryStringParameters?.productIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    return json(200, await loadOptionCatalog(getSupabaseAdmin(), ids));
  } catch (error) {
    return json(500, { error: error.message || 'No se pudieron cargar las opciones.', supabaseError: supabaseErrorDetails(error) });
  }
}

