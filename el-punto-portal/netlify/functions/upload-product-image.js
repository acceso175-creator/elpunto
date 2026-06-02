import { randomUUID } from 'node:crypto';

const MAX_SIZE_BYTES = 2 * 1024 * 1024;
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

function validateAdmin(secret) {
  const expected = env('ADMIN_UPLOAD_SECRET') || env('ADMIN_PIN');
  // MVP validation: replace this with Supabase Auth + an admin role before production hardening.
  return Boolean(expected && secret && secret === expected);
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

function serviceHeaders(extra = {}) {
  const { serviceRoleKey } = supabaseConfig();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra
  };
}

async function parseMultipart(event) {
  const body = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
  const request = new Request('https://local.netlify/upload', {
    method: 'POST',
    headers: event.headers,
    body
  });
  return request.formData();
}

async function supabaseFetch(path, options = {}) {
  const { url } = supabaseConfig();
  const response = await fetch(`${url}${path}`, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : data?.message || 'Error de Supabase');
  }
  return data;
}

async function ensureStorageBucket() {
  const { bucket } = supabaseConfig();
  await supabaseFetch(`/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
    method: 'GET',
    headers: serviceHeaders()
  });
}

async function ensureProductExists(productId) {
  const [record] = await supabaseFetch(`/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=id`, {
    method: 'GET',
    headers: serviceHeaders()
  });
  if (!record?.id) throw new Error('El producto no existe en Supabase. Guarda o migra el producto antes de subir imágenes.');
}

async function uploadImage(event) {
  const { url, bucket } = supabaseConfig();
  const missing = missingConfig();
  if (missing.length) {
    return errorJson(500, `Faltan variables de entorno en Netlify: ${missing.join(', ')}. Revisa que también estén disponibles para Deploy Previews.`);
  }

  const formData = await parseMultipart(event);
  if (!validateAdmin(String(formData.get('adminPin') || ''))) {
    return errorJson(401, 'Admin no autorizado para subir imágenes.');
  }

  const file = formData.get('image');
  const productId = String(formData.get('productId') || '').trim();
  if (!productId) return errorJson(400, 'Falta productId.');
  if (!file || typeof file.arrayBuffer !== 'function') return errorJson(400, 'Falta archivo de imagen.');
  if (!ALLOWED_TYPES.has(file.type)) return errorJson(400, 'Solo se aceptan imágenes jpeg, png o webp.');
  if (file.size > MAX_SIZE_BYTES) return errorJson(400, 'La imagen excede 2 MB.');

  await ensureStorageBucket();
  await ensureProductExists(productId);

  const extension = ALLOWED_TYPES.get(file.type);
  const random = randomUUID();
  const storagePath = `${productId}/${Date.now()}-${random}.${extension}`;
  const bytes = await file.arrayBuffer();

  await supabaseFetch(`/storage/v1/object/${bucket}/${storagePath}`, {
    method: 'POST',
    headers: serviceHeaders({
      'Content-Type': file.type,
      'Cache-Control': '31536000',
      'x-upsert': 'false'
    }),
    body: Buffer.from(bytes)
  });

  const publicUrl = `${url}/storage/v1/object/public/${bucket}/${storagePath}`;
  const sortOrder = Number(formData.get('sortOrder')) || 0;
  const [record] = await supabaseFetch('/rest/v1/product_images?select=id,product_id,image_url,storage_path,sort_order,created_at', {
    method: 'POST',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    body: JSON.stringify([{ product_id: productId, image_url: publicUrl, storage_path: storagePath, sort_order: sortOrder }])
  });

  return json(200, {
    ok: true,
    id: record.id,
    product_id: record.product_id,
    image_url: record.image_url,
    storage_path: record.storage_path,
    sort_order: record.sort_order,
    created_at: record.created_at
  });
}

async function deleteImage(event) {
  const { bucket } = supabaseConfig();
  const missing = missingConfig();
  if (missing.length) return errorJson(500, `Faltan variables de entorno en Netlify: ${missing.join(', ')}. Revisa que también estén disponibles para Deploy Previews.`);

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return errorJson(400, 'JSON inválido para eliminar imagen.');
  }
  if (!validateAdmin(String(payload.adminPin || ''))) {
    return errorJson(401, 'Admin no autorizado para eliminar imágenes.');
  }
  if (!payload.id || !payload.storage_path) return errorJson(400, 'Faltan id o storage_path.');

  await supabaseFetch(`/rest/v1/product_images?id=eq.${encodeURIComponent(payload.id)}`, {
    method: 'DELETE',
    headers: serviceHeaders({ Prefer: 'return=minimal' })
  });

  let storageWarning = '';
  try {
    await supabaseFetch(`/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: [payload.storage_path] })
    });
  } catch (error) {
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
    console.error('upload-product-image failed:', error);
    return errorJson(500, error.message || 'Error inesperado al manejar la imagen.');
  }
}
