import { getSupabaseAdmin, json, supabaseErrorDetails } from './_supabaseAdmin.js';

function fail(error, table) {
  const supabaseError = supabaseErrorDetails(error);
  console.error(`[public-product-options] ${table}`, supabaseError);
  return json(500, { error: supabaseError.message, table, supabaseError });
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido.' });
  try {
    const supabase = getSupabaseAdmin();
    const productIds = String(event.queryStringParameters?.productIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    let groupsQuery = supabase
      .from('product_option_groups')
      .select('id, product_id, name, required, selection_type, min_select, max_select, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (productIds.length) groupsQuery = groupsQuery.in('product_id', productIds);
    const groupsResult = await groupsQuery;
    if (groupsResult.error) return fail(groupsResult.error, 'product_option_groups');

    const groups = groupsResult.data || [];
    const groupIds = groups.map((group) => group.id);
    if (!groupIds.length) return json(200, { groups: [], options: [] });
    const optionsResult = await supabase
      .from('product_options')
      .select('id, group_id, name, price_delta, is_active, sort_order')
      .in('group_id', groupIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (optionsResult.error) return fail(optionsResult.error, 'product_options');
    return json(200, { groups, options: optionsResult.data || [] });
  } catch (error) {
    return fail(error, 'configuración de Supabase');
  }
}
