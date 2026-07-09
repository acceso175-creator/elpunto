import { dedupeOptions, duplicateOptionNames } from './_shared/optionDedup.js';
import { isAuthError, requireAdmin } from './_shared/requireAdmin.js';
import { getSupabaseAdmin, json, parseBody, supabaseErrorDetails } from './_supabaseAdmin.js';
import { UUID_RE } from './_shared/params.js';

const isUuid = (value) => UUID_RE.test(String(value || ''));
const bad = (message) => json(400, { error: message });

function fail(error) {
  const supabaseError = supabaseErrorDetails(error);
  console.error('[admin-option-templates]', supabaseError);
  return json(500, { error: supabaseError.message || 'No se pudo completar la operación.' });
}

function cleanTemplate(source = {}) {
  const template = source.template || source;
  const name = String(template.name || '').trim();
  if (!name) throw new Error('El nombre de la plantilla es obligatorio.');
  const selection_type = (template.selectionType ?? template.selection_type) === 'multiple' ? 'multiple' : 'single';
  const required = template.required === true;
  const min_select = Math.max(required ? 1 : 0, Number(template.minSelect ?? template.min_select ?? 0) || 0);
  const max_select = selection_type === 'single' ? 1 : Math.max(1, Number(template.maxSelect ?? template.max_select ?? 1) || 1);
  if (max_select < min_select) throw new Error('El máximo no puede ser menor que el mínimo.');
  return { name, selection_type, required, min_select, max_select, active: template.active !== false };
}

function cleanItems(items = []) {
  const duplicates = duplicateOptionNames(items);
  if (duplicates.length) throw new Error(`Esta plantilla contiene opciones duplicadas: ${duplicates[0]}.`);
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const name = String(item.name || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('No se puede guardar una opción sin nombre.');
    const price_delta = Number(Number(item.priceDelta ?? item.price_delta ?? 0).toFixed(2));
    if (!Number.isFinite(price_delta) || price_delta < 0) throw new Error(`Precio extra inválido para ${name}.`);
    return {
      id: isUuid(item.id) ? item.id : undefined,
      name,
      price_delta,
      sort_order: Number(item.sortOrder ?? item.sort_order ?? index) || 0,
      active: item.active !== false && item.isActive !== false
    };
  });
}

async function listTemplates(supabase) {
  const [templatesResult, itemsResult, usageResult] = await Promise.all([
    supabase.from('option_group_templates').select('*').order('name'),
    supabase.from('option_template_items').select('*').order('sort_order'),
    supabase.from('product_option_templates').select('template_id, product_id').eq('active', true)
  ]);
  if (templatesResult.error) throw templatesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (usageResult.error) throw usageResult.error;

  const usage = (usageResult.data || []).reduce((map, row) => map.set(row.template_id, (map.get(row.template_id) || 0) + 1), new Map());
  return (templatesResult.data || []).map((template) => ({
    id: template.id,
    name: template.name,
    selectionType: template.selection_type,
    minSelect: template.min_select,
    maxSelect: template.max_select,
    required: template.required,
    active: template.active,
    usageCount: usage.get(template.id) || 0,
    items: dedupeOptions((itemsResult.data || []).filter((item) => item.template_id === template.id)).map((item) => ({
      id: item.id,
      templateId: item.template_id,
      name: item.name,
      priceDelta: Number(item.price_delta || 0),
      sortOrder: item.sort_order,
      active: item.active
    }))
  }));
}

async function saveItems(supabase, templateId, items) {
  if (!Array.isArray(items)) return;
  const clean = cleanItems(items);
  const existing = await supabase.from('option_template_items').select('id').eq('template_id', templateId);
  if (existing.error) throw existing.error;

  const savedIds = [];
  for (const item of clean) {
    const payload = { ...item, template_id: templateId };
    const result = item.id
      ? await supabase.from('option_template_items').update(payload).eq('id', item.id).select('id').single()
      : await supabase.from('option_template_items').insert(payload).select('id').single();
    if (result.error) throw result.error;
    savedIds.push(result.data.id);
  }

  const removedIds = (existing.data || []).map((row) => row.id).filter((id) => !savedIds.includes(id));
  if (removedIds.length) {
    const removed = await supabase.from('option_template_items').delete().in('id', removedIds);
    if (removed.error) throw removed.error;
  }
}

export async function handler(event) {
  const admin = await requireAdmin(event);
  if (isAuthError(admin)) return json(admin.statusCode, admin.body);
  const supabase = getSupabaseAdmin();
  const body = event.httpMethod === 'GET' ? {} : parseBody(event);

  try {
    if (event.httpMethod === 'GET') return json(200, { templates: await listTemplates(supabase) });
    if (event.httpMethod === 'POST') {
      const created = await supabase.from('option_group_templates').insert(cleanTemplate(body)).select('id').single();
      if (created.error) throw created.error;
      await saveItems(supabase, created.data.id, body.items ?? body.template?.items);
      return json(201, { templates: await listTemplates(supabase) });
    }
    if (event.httpMethod === 'PATCH') {
      if (!isUuid(body.id)) return bad('id inválido.');
      const updated = await supabase.from('option_group_templates').update(cleanTemplate(body)).eq('id', body.id);
      if (updated.error) throw updated.error;
      await saveItems(supabase, body.id, body.items ?? body.template?.items);
      return json(200, { templates: await listTemplates(supabase) });
    }
    if (event.httpMethod === 'DELETE') {
      if (!isUuid(body.id)) return bad('id inválido.');
      const used = await supabase.from('product_option_templates').select('id', { count: 'exact', head: true }).eq('template_id', body.id);
      if (used.error) throw used.error;
      if ((used.count || 0) > 0 && body.confirm !== true) return json(409, { error: `La plantilla está en uso por ${used.count} producto(s). Confirma para eliminarla.`, usageCount: used.count });
      const removed = await supabase.from('option_group_templates').delete().eq('id', body.id);
      if (removed.error) throw removed.error;
      return json(200, { templates: await listTemplates(supabase) });
    }
    return json(405, { error: 'Método no permitido.' });
  } catch (error) {
    return /duplicadas|obligatorio|inválido|mínimo|máximo|nombre|Precio/.test(error.message || '') ? bad(error.message) : fail(error);
  }
}
