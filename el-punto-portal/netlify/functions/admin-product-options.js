import { getSupabaseAdmin, json, parseBody, supabaseErrorDetails, validateAdminPin } from './_supabaseAdmin.js';

function fail(error, context, statusCode = 500) {
  const supabaseError = supabaseErrorDetails(error);
  console.error(`[admin-product-options] ${context}`, supabaseError);
  return json(statusCode, { error: supabaseError.message, context, supabaseError });
}

function withContext(error, context) {
  return Object.assign(new Error(error?.message || 'Error desconocido de Supabase.'), supabaseErrorDetails(error), { context });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function cleanGroups(groups, productId) {
  return (Array.isArray(groups) ? groups : []).map((group, index) => {
    const name = String(group?.name || '').trim();
    if (!name) throw new Error('No se puede guardar un grupo de opciones sin nombre.');
    const selectionType = group.selectionType === 'multiple' || group.selection_type === 'multiple' ? 'multiple' : 'single';
    const required = group.required === true;
    const requestedMin = Number(group.minSelect ?? group.min_select ?? 0);
    const requestedMax = Number(group.maxSelect ?? group.max_select ?? 1);
    const minSelect = Math.max(required ? 1 : 0, Number.isFinite(requestedMin) ? requestedMin : 0);
    const maxSelect = selectionType === 'single' ? 1 : Math.max(1, minSelect, Number.isFinite(requestedMax) ? requestedMax : 1);
    const options = (Array.isArray(group.options) ? group.options : []).map((option, optionIndex) => {
      const optionName = String(option?.name || '').trim();
      const priceDelta = Number(option.priceDelta ?? option.price_delta ?? 0);
      if (!optionName) throw new Error(`No se puede guardar una opción sin nombre en ${name}.`);
      if (!Number.isFinite(priceDelta) || priceDelta < 0) throw new Error(`El precio extra de ${optionName} debe ser cero o positivo.`);
      return { id: isUuid(option.id) ? option.id : undefined, name: optionName, price_delta: priceDelta, is_active: option.isActive !== false && option.is_active !== false, sort_order: Number(option.sortOrder ?? option.sort_order ?? optionIndex) };
    });
    return { id: isUuid(group.id) ? group.id : undefined, row: { product_id: productId, name, required, selection_type: selectionType, min_select: minSelect, max_select: maxSelect, sort_order: Number(group.sortOrder ?? group.sort_order ?? index), is_active: group.isActive !== false && group.is_active !== false }, options };
  });
}

function toClientGroup(group, options) {
  return {
    id: group.id, productId: group.product_id, name: group.name, required: group.required === true,
    selectionType: group.selection_type === 'multiple' ? 'multiple' : 'single', minSelect: Number(group.min_select || 0),
    maxSelect: Number(group.max_select || 1), sortOrder: Number(group.sort_order || 0), isActive: group.is_active !== false,
    options: options.map((option) => ({ id: option.id, groupId: option.group_id, name: option.name, priceDelta: Number(option.price_delta || 0), isActive: option.is_active !== false, sortOrder: Number(option.sort_order || 0) }))
  };
}

async function loadOptions(supabase, productId) {
  const groupsResult = await supabase.from('product_option_groups').select('id, product_id, name, required, selection_type, min_select, max_select, sort_order, is_active').eq('product_id', productId).order('sort_order', { ascending: true });
  if (groupsResult.error) throw withContext(groupsResult.error, 'Cargando product_option_groups');
  const groups = groupsResult.data || [];
  const groupIds = groups.map((group) => group.id);
  const optionsResult = groupIds.length
    ? await supabase.from('product_options').select('id, group_id, name, price_delta, is_active, sort_order').in('group_id', groupIds).order('sort_order', { ascending: true })
    : { data: [], error: null };
  if (optionsResult.error) throw withContext(optionsResult.error, 'Cargando product_options');
  return groups.map((group) => toClientGroup(group, (optionsResult.data || []).filter((option) => option.group_id === group.id)));
}

async function saveOptions(supabase, productId, groups) {
  const clean = cleanGroups(groups, productId);
  const existingGroupsResult = await supabase.from('product_option_groups').select('id').eq('product_id', productId);
  if (existingGroupsResult.error) throw withContext(existingGroupsResult.error, 'Leyendo grupos existentes');
  const savedGroupIds = [];
  for (const group of clean) {
    const payload = group.id ? { ...group.row, id: group.id } : group.row;
    const result = group.id
      ? await supabase.from('product_option_groups').update(payload).eq('id', group.id).select('id').single()
      : await supabase.from('product_option_groups').insert(payload).select('id').single();
    if (result.error) throw withContext(result.error, `Guardando grupo ${group.row.name}`);
    const groupId = result.data.id;
    savedGroupIds.push(groupId);
    const existingOptionsResult = await supabase.from('product_options').select('id').eq('group_id', groupId);
    if (existingOptionsResult.error) throw withContext(existingOptionsResult.error, `Leyendo opciones de ${group.row.name}`);
    const savedOptionIds = [];
    for (const option of group.options) {
      const optionPayload = { ...option, group_id: groupId };
      const optionResult = option.id
        ? await supabase.from('product_options').update(optionPayload).eq('id', option.id).select('id').single()
        : await supabase.from('product_options').insert(optionPayload).select('id').single();
      if (optionResult.error) throw withContext(optionResult.error, `Guardando opción ${option.name}`);
      savedOptionIds.push(optionResult.data.id);
    }
    const removedOptions = (existingOptionsResult.data || []).map(({ id }) => id).filter((id) => !savedOptionIds.includes(id));
    if (removedOptions.length) {
      const result = await supabase.from('product_options').delete().in('id', removedOptions);
      if (result.error) throw withContext(result.error, `Eliminando opciones de ${group.row.name}`);
    }
  }
  const removedGroups = (existingGroupsResult.data || []).map(({ id }) => id).filter((id) => !savedGroupIds.includes(id));
  if (removedGroups.length) {
    const result = await supabase.from('product_option_groups').delete().in('id', removedGroups);
    if (result.error) throw withContext(result.error, 'Eliminando grupos removidos');
  }
  return loadOptions(supabase, productId);
}

export async function handler(event) {
  const body = parseBody(event);
  const pin = body.adminPin || event.headers['x-admin-pin'];
  if (!validateAdminPin(pin)) return json(401, { error: 'PIN de admin inválido.' });
  const productId = body.productId || event.queryStringParameters?.productId;
  if (!productId) return json(400, { error: 'Falta productId.' });
  try {
    const supabase = getSupabaseAdmin();
    if (event.httpMethod === 'GET') return json(200, { productId, groups: await loadOptions(supabase, productId) });
    if (event.httpMethod === 'PUT') return json(200, { productId, groups: await saveOptions(supabase, productId, body.groups) });
    return json(405, { error: 'Método no permitido.' });
  } catch (error) {
    return fail(error, error.context || 'Operación de opciones');
  }
}
