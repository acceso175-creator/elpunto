import { isAuthError, requireAdmin } from './_shared/requireAdmin.js';
import { ensureCategory, getSupabaseAdmin, json, menuSnapshot, parseBody, slugify } from './_supabaseAdmin.js';

export async function handler(event) {
  try {
    const body = parseBody(event);
    const admin = await requireAdmin(event);
    if (isAuthError(admin)) return json(admin.statusCode, admin.body);
    const supabase = getSupabaseAdmin();

    if (event.httpMethod === 'GET') return json(200, await menuSnapshot(supabase));
    if (event.httpMethod === 'POST') {
      const category = await ensureCategory(supabase, body.category || { name: body.name, slug: body.slug || slugify(body.name) });
      return json(200, { category });
    }
    if (event.httpMethod === 'PATCH') {
      if (body.action === 'reorder') {
        const categories = Array.isArray(body.categories) ? body.categories : [];
        for (const category of categories) {
          const sortOrder = Number(category.sortOrder ?? category.sort_order);
          if (!Number.isFinite(sortOrder)) continue;
          const query = supabase.from('categories').update({ sort_order: sortOrder, updated_at: new Date().toISOString() });
          const { error } = category.id ? await query.eq('id', category.id) : await query.eq('slug', category.slug);
          if (error) throw new Error(error.message);
        }
        return json(200, await menuSnapshot(supabase));
      }
      if (!body.id && !body.slug) return json(400, { error: 'Falta id o slug de categoría.' });
      const patch = {
        ...(body.name ? { name: String(body.name).trim(), slug: body.slug || slugify(body.name) } : {}),
        ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
        ...(body.sortOrder !== undefined || body.sort_order !== undefined ? { sort_order: Number(body.sortOrder ?? body.sort_order) } : {}),
        updated_at: new Date().toISOString()
      };
      const query = supabase.from('categories').update(patch).select('id, name, slug, sort_order, active');
      const { data, error } = body.id ? await query.eq('id', body.id).single() : await query.eq('slug', body.slug).single();
      if (error) throw new Error(error.message);
      return json(200, { category: data });
    }
    if (event.httpMethod === 'DELETE') {
      if (!body.id && !body.slug) return json(400, { error: 'Falta id o slug de categoría.' });
      const query = supabase.from('categories').delete();
      const { error } = body.id ? await query.eq('id', body.id) : await query.eq('slug', body.slug);
      if (error) throw new Error(error.message);
      return json(200, { ok: true });
    }
    return json(405, { error: 'Método no permitido.' });
  } catch (error) {
    return json(500, { error: error.message || 'Error inesperado en categorías.' });
  }
}
