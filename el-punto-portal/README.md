# El Punto — Food To Go

Portal MVP para tomar pedidos por WhatsApp, pensado para modificarse con Codex, subirse a GitHub y desplegarse en Netlify.

## Qué incluye

- Menú dividido en Desayunos, Birria y Bebidas.
- Productos con ingredientes removibles.
- Selección de cantidad y opciones por producto.
- Carrito de pedido.
- Pedido para recoger o a domicilio.
- Captura de dirección y ubicación con navegador.
- Mensaje automático a WhatsApp con número de orden, pedido, método de pago y ubicación.
- Panel Admin en `/admin` para editar negocio, disponibilidad, productos, ingredientes e imágenes.
- Imágenes de productos en Supabase Storage + metadatos en Supabase Database.
- Club El Punto para datos rápidos de cliente frecuente.

## Importante de seguridad

Esta versión mantiene el menú y ajustes básicos en `localStorage`, pero las imágenes nuevas de productos **no** se guardan en base64 ni en `localStorage`: se suben a Supabase Storage desde una Netlify Function.

- `VITE_SUPABASE_ANON_KEY` puede estar en el frontend solo si RLS no permite escrituras peligrosas.
- `SUPABASE_SERVICE_ROLE_KEY` va únicamente en Netlify Functions. Nunca la pongas en Vite ni en código del navegador.
- No abras escritura pública al bucket `product-images`.
- El PIN de Admin es un MVP; en producción reemplázalo con Supabase Auth y rol admin.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy en Netlify

1. Sube este proyecto a GitHub.
2. En Netlify, crea un sitio nuevo desde GitHub.
3. Selecciona el repositorio.
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Configura las variables de entorno de Supabase y Admin listadas abajo.
7. Deploy.

El archivo `netlify.toml` ya trae el build y el redirect SPA para que `/admin` funcione al refrescar.

## Variables de entorno en Netlify

Configura estas variables en **Site configuration → Environment variables**:

```txt
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
SUPABASE_STORAGE_BUCKET=product-images
ADMIN_PIN=1234
```

Opcionalmente puedes usar `ADMIN_UPLOAD_SECRET` para uploads si quieres separar el PIN visual del secreto de subida. Si existe, la función lo usa antes que `ADMIN_PIN`.

## Configuración de Supabase

1. Crea un proyecto en Supabase.
2. Ejecuta el SQL de `supabase/schema.sql` en el SQL Editor.
3. Verifica que exista el bucket `product-images` en Storage.
4. Mantén el bucket sin permisos de escritura pública. La subida y borrado se hacen por Netlify Function con `SUPABASE_SERVICE_ROLE_KEY`.
5. Copia URL, anon key y service role key a Netlify.

El SQL crea:

- `products`
- `product_ingredients`
- `product_images`
- bucket recomendado `product-images`
- políticas de lectura pública para productos/imágenes y sin escrituras públicas.

## Cómo subir imágenes desde Admin

1. Entra a `/admin`.
2. Desbloquea el panel con el PIN configurado (`ADMIN_PIN`).
3. En cada producto, abre el bloque **Imágenes Supabase**.
4. Selecciona archivos desde el input de subida.
5. Formatos aceptados: `image/png`, `image/jpeg`, `image/webp`.
6. Tamaño máximo por imagen: 2 MB.
7. Máximo 5 imágenes por producto.
8. Al subir, la Netlify Function guarda el archivo en Supabase Storage y registra `image_url`, `storage_path`, `sort_order` y `product_id` en `product_images`.
9. Para eliminar, usa el botón **Eliminar** en la preview: primero borra el registro y luego intenta borrar el archivo del bucket.

## Admin demo

PIN local por defecto en el frontend: `1234`.

Para deploy, configura `ADMIN_PIN` en Netlify con el mismo valor que usarás para desbloquear y subir imágenes. Cámbialo antes de producción.

## Dónde editar el menú inicial

Archivo:

```txt
src/menuData.js
```

También se puede editar desde el panel Admin, pero esos cambios de menú quedan guardados en el navegador. Las imágenes se guardan en Supabase y se asocian al producto con un UUID interno estable (`supabaseProductId`).

## Siguiente mejora recomendada

La siguiente versión debería migrar también productos, ingredientes, pedidos y admin a Supabase con Auth real para tener:

- menú persistente real,
- login de admin,
- cuentas de cliente,
- historial de pedidos,
- métricas reales,
- cupones/beneficios por usuario.
