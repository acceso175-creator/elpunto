import { dedupeOptions, normalizeOptionName, optionDedupKey } from './_shared/optionDedup.js';
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

    const directGroups = groupsResult.data || [];
    const groupIds = directGroups.map((group) => group.id);
    const optionsResult = groupIds.length
      ? await supabase
        .from('product_options')
        .select('id, group_id, name, price_delta, is_active, sort_order')
        .in('group_id', groupIds)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      : { data: [], error: null };
    if (optionsResult.error) return fail(optionsResult.error, 'product_options');

    let assignmentsQuery = supabase
      .from('product_option_templates')
      .select('id, product_id, template_id, sort_order, active, option_group_templates(id, name, required, selection_type, min_select, max_select, active)')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (productIds.length) assignmentsQuery = assignmentsQuery.in('product_id', productIds);
    const assignmentsResult = await assignmentsQuery;
    if (assignmentsResult.error) return fail(assignmentsResult.error, 'product_option_templates');
    const assignments = (assignmentsResult.data || []).filter((row) => row.option_group_templates?.active !== false);
    const templateIds = [...new Set(assignments.map((row) => row.template_id))];
    const templateItemsResult = templateIds.length
      ? await supabase.from('option_template_items').select('id, template_id, name, price_delta, active, sort_order').in('template_id', templateIds).eq('active', true).order('sort_order', { ascending: true })
      : { data: [], error: null };
    if (templateItemsResult.error) return fail(templateItemsResult.error, 'option_template_items');

    const templateGroups = assignments
      .map((row) => ({ id: `tpl-${row.template_id}`, product_id: row.product_id, template_id: row.template_id, name: row.option_group_templates.name, required: row.option_group_templates.required, selection_type: row.option_group_templates.selection_type, min_select: row.option_group_templates.min_select, max_select: row.option_group_templates.max_select, sort_order: row.sort_order, is_active: true, is_template: true }));
    const templateOptions = templateGroups.flatMap((group) => dedupeOptions((templateItemsResult.data || []).filter((item) => item.template_id === group.template_id)).map((item) => ({ id: `tplopt-${item.id}`, group_id: group.id, template_id: group.template_id, template_item_id: item.id, name: item.name, price_delta: item.price_delta, is_active: item.active, sort_order: item.sort_order })));
    const allOptions = [...(optionsResult.data || []), ...templateOptions];
    const optionsByGroup = allOptions.reduce((map, option) => map.set(option.group_id, [...(map.get(option.group_id) || []), option]), new Map());
    const groupSignature = (group) => [group.product_id, normalizeOptionName(group.name), group.selection_type, dedupeOptions(optionsByGroup.get(group.id) || []).map(optionDedupKey).sort().join(',')].join('|');
    const bySignature = new Map();
    [...templateGroups, ...directGroups].forEach((group) => { if (!bySignature.has(groupSignature(group))) bySignature.set(groupSignature(group), group); });
    const groups = [...bySignature.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const groupIdsToReturn = new Set(groups.map((group) => group.id));
    const options = groups.flatMap((group) => dedupeOptions(optionsByGroup.get(group.id) || [])).filter((option) => groupIdsToReturn.has(option.group_id));
    return json(200, { groups, options });
  } catch (error) {
    return fail(error, 'configuración de Supabase');
  }
}
