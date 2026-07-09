import { isAuthError, requireAdmin } from './_shared/requireAdmin.js';
import { getParam, invalidUuidResponse, UUID_RE } from './_shared/params.js';
import { getSupabaseAdmin, json, parseBody, supabaseErrorDetails } from './_supabaseAdmin.js';

const isUuid = (value) => UUID_RE.test(String(value || ''));
const bad = (message) => json(400, { error: message });

function fail(error) {
  const supabaseError = supabaseErrorDetails(error);
  console.error('[admin-product-option-templates]', supabaseError);
  return json(500, { error: supabaseError.message || 'No se pudo completar la operación.' });
}

async function assigned(supabase, productId) {
  const [assignmentsResult, itemsResult] = await Promise.all([
    supabase
      .from('product_option_templates')
      .select('id, product_id, template_id, sort_order, active, option_group_templates(id, name, selection_type, min_select, max_select, required, active)')
      .eq('product_id', productId)
      .eq('active', true)
      .order('sort_order'),
    supabase.from('option_template_items').select('*').eq('active', true).order('sort_order')
  ]);
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (itemsResult.error) throw itemsResult.error;

  return (assignmentsResult.data || []).map((assignment) => ({
    id: `tpl-${assignment.template_id}`,
    assignmentId: assignment.id,
    productId: assignment.product_id,
    templateId: assignment.template_id,
    name: assignment.option_group_templates?.name,
    selectionType: assignment.option_group_templates?.selection_type,
    minSelect: assignment.option_group_templates?.min_select,
    maxSelect: assignment.option_group_templates?.max_select,
    required: assignment.option_group_templates?.required,
    isActive: assignment.active !== false && assignment.option_group_templates?.active !== false,
    isTemplate: true,
    sortOrder: assignment.sort_order,
    options: (itemsResult.data || [])
      .filter((item) => item.template_id === assignment.template_id)
      .map((item) => ({
        id: `tplopt-${item.id}`,
        templateItemId: item.id,
        groupId: `tpl-${assignment.template_id}`,
        name: item.name,
        priceDelta: Number(item.price_delta || 0),
        sortOrder: item.sort_order,
        isActive: item.active
      }))
  }));
}

export async function handler(event) {
  const admin = await requireAdmin(event);
  if (isAuthError(admin)) return json(admin.statusCode, admin.body);

  const supabase = getSupabaseAdmin();
  const body = event.httpMethod === 'GET' ? {} : parseBody(event);
  const productId = getParam(event.queryStringParameters, 'productId') || getParam(body, 'productId');
  const templateId = getParam(event.queryStringParameters, 'templateId') || getParam(body, 'templateId');

  if (!isUuid(productId)) return invalidUuidResponse(json, 'productId', productId);

  try {
    if (event.httpMethod === 'GET') return json(200, { groups: await assigned(supabase, productId) });

    if (event.httpMethod === 'POST') {
      if (!isUuid(templateId)) return bad('templateId inválido.');
      const result = await supabase
        .from('product_option_templates')
        .upsert({ product_id: productId, template_id: templateId, sort_order: Number(getParam(body, 'sortOrder') || 0), active: true }, { onConflict: 'product_id,template_id' });
      if (result.error) throw result.error;
      return json(200, { groups: await assigned(supabase, productId) });
    }

    if (event.httpMethod === 'DELETE') {
      if (!isUuid(templateId)) return bad('templateId inválido.');
      const result = await supabase.from('product_option_templates').delete().eq('product_id', productId).eq('template_id', templateId);
      if (result.error) throw result.error;
      return json(200, { groups: await assigned(supabase, productId) });
    }

    if (event.httpMethod === 'PATCH' && getParam(body, 'action') === 'unlink') {
      if (!isUuid(templateId)) return bad('templateId inválido.');
      const templateResult = await supabase.from('option_group_templates').select('*').eq('id', templateId).single();
      if (templateResult.error) throw templateResult.error;
      const itemsResult = await supabase.from('option_template_items').select('*').eq('template_id', templateId).order('sort_order');
      if (itemsResult.error) throw itemsResult.error;

      const groupResult = await supabase
        .from('product_option_groups')
        .insert({
          product_id: productId,
          name: templateResult.data.name,
          required: templateResult.data.required,
          selection_type: templateResult.data.selection_type,
          min_select: templateResult.data.min_select,
          max_select: templateResult.data.max_select,
          sort_order: Number(getParam(body, 'sortOrder') || 0),
          is_active: true
        })
        .select('id')
        .single();
      if (groupResult.error) throw groupResult.error;

      const optionRows = (itemsResult.data || []).map((item) => ({
        group_id: groupResult.data.id,
        name: item.name,
        price_delta: item.price_delta,
        sort_order: item.sort_order,
        is_active: item.active
      }));
      if (optionRows.length) {
        const optionsResult = await supabase.from('product_options').insert(optionRows);
        if (optionsResult.error) throw optionsResult.error;
      }

      const deleteResult = await supabase.from('product_option_templates').delete().eq('product_id', productId).eq('template_id', templateId);
      if (deleteResult.error) throw deleteResult.error;
      return json(200, { groups: await assigned(supabase, productId), unlinkedGroupId: groupResult.data.id });
    }

    return json(405, { error: 'Método no permitido.' });
  } catch (error) {
    return fail(error);
  }
}
