import { dedupeOptions, normalizeOptionName, optionDedupKey, sortOptionGroups } from './optionDedup.js';

// One catalog for the public menu, admin capture and server-side pricing.
export async function loadOptionCatalog(supabase, productIds = [], { activeOnly = true } = {}) {
  let query = supabase.from('product_option_groups').select('id, product_id, name, required, selection_type, min_select, max_select, sort_order, is_active').order('sort_order', { ascending: true });
  if (productIds.length) query = query.in('product_id', productIds);
  if (activeOnly) query = query.eq('is_active', true);
  const direct = await query;
  if (direct.error) throw direct.error;
  const groupIds = (direct.data || []).map((group) => group.id);
  let optionQuery = groupIds.length ? supabase.from('product_options').select('id, group_id, name, price_delta, is_active, sort_order').in('group_id', groupIds).order('sort_order', { ascending: true }) : null;
  if (optionQuery && activeOnly) optionQuery = optionQuery.eq('is_active', true);
  const optionsResult = optionQuery ? await optionQuery : { data: [] };
  if (optionsResult.error) throw optionsResult.error;
  let assignmentsQuery = supabase.from('product_option_templates').select('id, product_id, template_id, sort_order, active, option_group_templates(id, name, required, selection_type, min_select, max_select, active)').eq('active', true).order('sort_order', { ascending: true });
  if (productIds.length) assignmentsQuery = assignmentsQuery.in('product_id', productIds);
  const assignmentsResult = await assignmentsQuery;
  if (assignmentsResult.error) throw assignmentsResult.error;
  const assignments = (assignmentsResult.data || []).filter((row) => row.option_group_templates && row.option_group_templates.active !== false);
  const templateIds = [...new Set(assignments.map((row) => row.template_id))];
  const templateItems = templateIds.length ? await supabase.from('option_template_items').select('id, template_id, name, price_delta, active, sort_order').in('template_id', templateIds).eq('active', true).order('sort_order', { ascending: true }) : { data: [] };
  if (templateItems.error) throw templateItems.error;
  const templateGroups = assignments.map((row) => ({ ...row.option_group_templates, id: `tpl-${row.template_id}`, product_id: row.product_id, template_id: row.template_id, sort_order: row.sort_order, is_active: true, is_template: true }));
  const templateOptions = templateGroups.flatMap((group) => dedupeOptions((templateItems.data || []).filter((item) => item.template_id === group.template_id)).map((item) => ({ id: `tplopt-${item.id}`, group_id: group.id, template_id: group.template_id, template_item_id: item.id, name: item.name, price_delta: item.price_delta, is_active: item.active, sort_order: item.sort_order })));
  const optionsByGroup = [...(optionsResult.data || []), ...templateOptions].reduce((map, option) => map.set(option.group_id, [...(map.get(option.group_id) || []), option]), new Map());
  const signature = (group) => [group.product_id, normalizeOptionName(group.name), group.selection_type, dedupeOptions(optionsByGroup.get(group.id) || []).map(optionDedupKey).sort().join(',')].join('|');
  const unique = new Map();
  [...templateGroups, ...(direct.data || [])].forEach((group) => { if (!unique.has(signature(group))) unique.set(signature(group), group); });
  const groups = sortOptionGroups([...unique.values()]);
  const options = new Map();
  groups.forEach((group) => dedupeOptions(optionsByGroup.get(group.id) || []).forEach((option) => options.set(`${option.group_id}:${option.id}`, option)));
  return { groups, options: [...options.values()] };
}
