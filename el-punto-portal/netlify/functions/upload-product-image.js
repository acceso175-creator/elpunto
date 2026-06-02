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

function missingConfigResponse() {
  const [firstMissing] = missingConfig();
  return firstMissing ? errorJson(500, `Missing env var: ${firstMissing}`) : null;
}

function serviceHeaders(extra = {}) {
  const { serviceRoleKey } = supabaseConfig();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra
  };
}

function parseContentDisposition(value = '') {
  return Object.fromEntries([...value.matchAll(/;\s*([^=]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function trimPartBuffer(buffer) {
  let start = 0;
  let end = buffer.length;
  if (end - start >= 2 && buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
  if (end - start >= 2 && buffer[end - 2] === 13 && buffer[end - 1] === 10) end -= 2;
  return buffer.subarray(start, end);
}

async function parseMultipart(event) {
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || '').trim();
  if (!boundary) throw new Error('No se encontró boundary de multipart/form-data.');

  const body = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const fields = new Map();
  let cursor = body.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    cursor += boundaryBuffer.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;

    const nextBoundary = body.indexOf(boundaryBuffer, cursor);
    if (nextBoundary === -1) break;

    const rawPart = trimPartBuffer(body.subarray(cursor, nextBoundary));
    const headerEnd = rawPart.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerText = rawPart.subarray(0, headerEnd).toString('utf8');
      const content = rawPart.subarray(headerEnd + 4);
      const headers = Object.fromEntries(headerText.split('\r\n').map((line) => {
        const separator = line.indexOf(':');
        return separator === -1 ? ['', ''] : [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      }).filter(([key]) => key));
      const disposition = parseContentDisposition(headers['content-disposition'] || '');
      if (disposition.name) {
        if (disposition.filename !== undefined) {
          const fileBuffer = Buffer.from(content);
          fields.set(disposition.name, {
            name: disposition.filename,
            type: headers['content-type'] || 'application/octet-stream',
            size: fileBuffer.length,
            async arrayBuffer() {
              return fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
            }
          });
        } else {
          fields.set(disposition.name, content.toString('utf8'));
        }
      }
    }
    cursor = nextBoundary;
  }

  return { get: (name) => fields.get(name) ?? null };
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
    const message = typeof data === 'string' ? data : data?.message || data?.error || 'Error de Supabase';
    console.error('Supabase request failed:', { path, status: response.status, message });
    throw new Error(message);
  }
  return data;
}

async function ensureStorageBucket() {
  const { bucket } = supabaseConfig();
  console.info('upload-product-image bucket check:', { bucket });
  try {
    await supabaseFetch(`/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      method: 'GET',
      headers: serviceHeaders()
    });
  } catch (error) {
    throw new Error(`Bucket de imágenes no disponible (${bucket}): ${error.message}`);
  }
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
  const configError = missingConfigResponse();
  if (configError) return configError;

  console.info('upload-product-image request:', { contentType: event.headers?.['content-type'] || event.headers?.['Content-Type'] || '', isBase64Encoded: event.isBase64Encoded === true });
  const formData = await parseMultipart(event);
  if (!validateAdmin(String(formData.get('adminPin') || ''))) {
    return errorJson(401, 'Admin no autorizado para subir imágenes.');
  }

  const file = formData.get('image');
  const productId = String(formData.get('productId') || '').trim();
  console.info('upload-product-image file received:', { hasFile: Boolean(file), productId, bucket, fileName: file?.name || '', fileType: file?.type || '', fileSize: file?.size || 0 });
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

  try {
    await supabaseFetch(`/storage/v1/object/${bucket}/${storagePath}`, {
      method: 'POST',
      headers: serviceHeaders({
        'Content-Type': file.type,
        'Cache-Control': '31536000',
        'x-upsert': 'false'
      }),
      body: Buffer.from(bytes)
    });
  } catch (storageError) {
    console.error('upload-product-image storage upload failed:', { bucket, productId, storagePath, message: storageError.message });
    return errorJson(500, storageError.message || 'Error al subir imagen a Supabase Storage.');
  }

  const publicUrl = `${url}/storage/v1/object/public/${bucket}/${storagePath}`;
  const sortOrder = Number(formData.get('sortOrder')) || 0;
  let record;
  try {
    [record] = await supabaseFetch('/rest/v1/product_images?select=id,product_id,image_url,storage_path,sort_order,created_at', {
      method: 'POST',
      headers: serviceHeaders({
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      }),
      body: JSON.stringify([{ product_id: productId, image_url: publicUrl, storage_path: storagePath, sort_order: sortOrder }])
    });
  } catch (dbError) {
    console.error('upload-product-image product_images insert failed:', { productId, storagePath, message: dbError.message });
    return errorJson(500, dbError.message || 'Error al guardar registro de imagen del producto.');
  }

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
  const configError = missingConfigResponse();
  if (configError) return configError;

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
