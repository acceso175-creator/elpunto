import { createClient } from '@supabase/supabase-js';

function jsonError(statusCode, error) {
  return { statusCode, body: { error } };
}

export async function requireAdmin(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match) return jsonError(401, 'Tu sesión expiró. Inicia sesión nuevamente.');

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return jsonError(500, 'Faltan variables de entorno de Supabase en Netlify.');

  const token = match[1];
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) return jsonError(401, 'Tu sesión expiró. Inicia sesión nuevamente.');

  const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: admin, error: adminError } = await adminClient
    .from('admin_users')
    .select('user_id, email, active')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (adminError) return jsonError(500, 'No se pudo validar el permiso administrativo.');
  if (!admin?.user_id || admin.active !== true) return jsonError(403, 'Tu cuenta no tiene permisos de administrador.');

  return { userId: user.id, email: admin.email || user.email || null };
}

export function isAuthError(result) {
  return result?.statusCode && result?.body?.error;
}
