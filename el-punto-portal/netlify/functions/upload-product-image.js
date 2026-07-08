import { isAuthError, requireAdmin } from './_shared/requireAdmin.js';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES_PER_PRODUCT = 5;
const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function errorJson(statusCode, message, details = {}) {
  return json(statusCode, { ok: false, error: message, ...details });
}

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function supabaseConfig() {
  return {
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    bucket: env('SUPABASE_STORAGE_BUCKET', 'product-images')
  };
}

function missingConfig() {
  const { url, serviceRoleKey, bucket } = supabaseConfig();
  return [
    !url && 'SUPABASE_URL',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !bucket && 'SUPABASE_STORAGE_BUCKET'
  ].filter(Boolean);
}

function missingConfigResponse() {
  const [firstMissing] = missingConfig();
  return firstMissing ? errorJson(500, `Missing env var: ${firstMissing}`) : null;
}

function getSupabaseAdmin() {
  const { url, serviceRoleKey } = supabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function parseJsonBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    throw new Error('JSON inválido para subir imagen.');
  }
}

function cleanBase64(value = '') {
  return String(value).replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
}

function safeFileName(fileName = '', mimeType = '') {
  const extension = ALLOWED_TYPES.get(mimeType) || 'webp';
  const base = String(fileName || `imagen.${extension}`)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\.[^.]+$/, '')
    .slice(0, 80) || 'imagen';
  return `${base}.${extension}`;
}

async function ensureStorageBucket(supabase, bucket) {
  console.info('upload-product-image bucket check:', { bucket });
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (error || !data) {
    console.error('upload-product-image bucket check failed:', { bucket, message: error?.message || 'Bucket no encontrado' });
    throw new Error(`Bucket de imágenes no disponible (${bucket}): ${error?.message || 'Bucket no encontrado'}`);
  }
}

async function ensureProductExists(supabase, productId) {
  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error('El producto no existe en Supabase. Guarda o migra el producto antes de subir imágenes.');
}

async function productImageCount(supabase, productId) {
  const { count, error } = await supabase
    .from('product_images')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);
  if (error) throw new Error(error.message);
  return count || 0;
}

async function uploadImage(event) {
  const { bucket } = supabaseConfig();
  const configError = missingConfigResponse();
  if (configError) return configError;

  const payload = parseJsonBody(event);
  const productId = String(payload.productId || '').trim();
  const fileName = String(payload.fileName || '').trim();
  const mimeType = String(payload.mimeType || '').trim().toLowerCase();
  const base64 = cleanBase64(payload.base64);
  const sortOrder = Number(payload.sortOrder) || 0;

  console.info('upload-product-image JSON request:', { productId, fileName, mimeType, bucket, hasBase64: Boolean(base64) });

  const admin = await requireAdmin(event);
  if (isAuthError(admin)) return errorJson(admin.statusCode, admin.body.error);
  if (!productId) return errorJson(400, 'productId requerido.');
  if (!fileName) return errorJson(400, 'fileName requerido.');
  if (!mimeType) return errorJson(400, 'mimeType requerido.');
  if (!base64) return errorJson(400, 'base64 requerido.');
  if (!ALLOWED_TYPES.has(mimeType)) return errorJson(400, 'Solo se aceptan imágenes jpeg, png o webp.');

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return errorJson(400, 'base64 inválido.');
  }
  console.info('upload-product-image decoded file:', { productId, fileName, mimeType, bufferSize: buffer.length, bucket });
  if (!buffer.length) return errorJson(400, 'base64 inválido o vacío.');
  if (buffer.length > MAX_SIZE_BYTES) return errorJson(400, 'La imagen excede 2 MB.');

  const supabase = getSupabaseAdmin();
  await ensureStorageBucket(supabase, bucket);
  await ensureProductExists(supabase, productId);

  const currentCount = await productImageCount(supabase, productId);
  if (currentCount >= MAX_IMAGES_PER_PRODUCT) return errorJson(400, 'Máximo 5 imágenes por producto.');

  const cleanName = safeFileName(fileName, mimeType);
  const storagePath = `products/${productId}/${Date.now()}-${randomUUID()}-${cleanName}`;
  const { error: storageError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      cacheControl: '31536000',
      upsert: false
    });

  if (storageError) {
    console.error('upload-product-image storage upload failed:', { bucket, productId, storagePath, message: storageError.message });
    return errorJson(500, storageError.message || 'Error al subir imagen a Supabase Storage.');
  }

  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const publicUrl = publicUrlData?.publicUrl || '';
  const { data: record, error: dbError } = await supabase
    .from('product_images')
    .insert({ product_id: productId, image_url: publicUrl, storage_path: storagePath, sort_order: sortOrder || currentCount })
    .select('id, product_id, image_url, storage_path, sort_order, created_at')
    .single();

  if (dbError) {
    console.error('upload-product-image product_images insert failed:', { productId, storagePath, message: dbError.message });
    return errorJson(500, dbError.message || 'Error al guardar registro de imagen del producto.');
  }

  return json(200, {
    ok: true,
    id: record.id,
    product_id: record.product_id,
    image_url: record.image_url,
    url: record.image_url,
    storage_path: record.storage_path,
    path: record.storage_path,
    sort_order: record.sort_order,
    created_at: record.created_at
  });
}

async function deleteImage(event) {
  const { bucket } = supabaseConfig();
  const configError = missingConfigResponse();
  if (configError) return configError;

  const payload = parseJsonBody(event);
  const admin = await requireAdmin(event);
  if (isAuthError(admin)) return errorJson(admin.statusCode, admin.body.error);
  if (!payload.id || !payload.storage_path) return errorJson(400, 'Faltan id o storage_path.');

  const supabase = getSupabaseAdmin();
  const { error: dbError } = await supabase
    .from('product_images')
    .delete()
    .eq('id', payload.id);
  if (dbError) return errorJson(500, dbError.message || 'No se pudo eliminar el registro de imagen.');

  let storageWarning = '';
  const { error: storageError } = await supabase.storage.from(bucket).remove([payload.storage_path]);
  if (storageError) {
    console.error('upload-product-image storage delete failed:', { bucket, storagePath: payload.storage_path, message: storageError.message });
    storageWarning = 'Se borró el registro, pero no se pudo borrar el archivo del bucket.';
  }

  return json(200, { ok: true, warning: storageWarning });
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
    if (event.httpMethod === 'POST') return await uploadImage(event);
    if (event.httpMethod === 'DELETE') return await deleteImage(event);
    return errorJson(405, 'Método no permitido.');
  } catch (error) {
    console.error('upload-product-image failed:', { message: error.message, stack: error.stack });
    return errorJson(500, error.message || 'Error inesperado al manejar la imagen.');
  }
}
