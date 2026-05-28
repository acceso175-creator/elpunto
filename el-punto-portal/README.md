# El Punto — Food To Go

Portal React/Vite para tomar pedidos por WhatsApp, administrar menú y conectar el menú principal con Supabase sin perder el fallback local.

## Qué incluye

- Inicio, ubicación, menú con filtros, productos y carrito.
- Ingredientes removibles por producto.
- Pedido por WhatsApp con número de orden, método de pago, notas y ubicación.
- Panel Admin en `/admin` para editar negocio, categorías, productos, disponibilidad, ingredientes e imágenes.
- Supabase como base de datos principal para categorías, productos, ingredientes, imágenes y configuración del negocio.
- `localStorage` como fallback cuando Supabase no está configurado o falla.
- Supabase Storage para imágenes de productos mediante Netlify Functions.

## Seguridad importante

- `VITE_SUPABASE_ANON_KEY` puede vivir en frontend solo porque RLS bloquea escrituras públicas.
- `SUPABASE_SERVICE_ROLE_KEY` va únicamente en Netlify Functions. Nunca la pongas en Vite ni en código del navegador.
- El admin escribe en Supabase mediante Netlify Functions y valida `ADMIN_PIN` como MVP.
- En producción, reemplaza el PIN por Supabase Auth con rol admin.
- No habilites escrituras públicas para tablas ni para Storage.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

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

`SUPABASE_SERVICE_ROLE_KEY` y `ADMIN_PIN` son privadas de Netlify Functions. No deben empezar con `VITE_`.

## Configuración de Supabase

1. Crea un proyecto en Supabase.
2. Abre el SQL Editor.
3. Ejecuta completo el archivo `supabase/schema.sql`.
4. Verifica que exista el bucket público de lectura `product-images` en Storage.
5. Confirma que no existan políticas de escritura pública en tablas ni en `storage.objects`.
6. Copia URL, anon key y service role key a Netlify.
7. Deploy en Netlify.
8. Entra a `/admin`, escribe el mismo `ADMIN_PIN` configurado en Netlify y prueba editar un producto.
9. Sube imágenes desde el bloque de imágenes de cada producto.
10. Revisa el menú público y confirma que los filtros, carrito y WhatsApp siguen funcionando.

## Qué crea `supabase/schema.sql`

- `business_settings`
- `categories`
- `products`
- `product_ingredients`
- `product_images`
- Triggers de `updated_at`
- RLS activado
- Políticas de lectura pública segura:
  - categorías activas,
  - productos disponibles,
  - ingredientes e imágenes de productos disponibles,
  - configuración del negocio.
- Seed inicial:
  - categorías `Desayunos`, `Birria`, `Bebidas`, `Postres`,
  - productos actuales del menú,
  - ingredientes actuales,
  - configuración inicial del negocio.
- Bucket `product-images` público para lectura.

## Admin conectado a Supabase

Las escrituras del admin usan estas Netlify Functions:

- `netlify/functions/admin-products.js`
- `netlify/functions/admin-categories.js`
- `netlify/functions/admin-settings.js`
- `netlify/functions/upload-product-image.js`

El frontend solo usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para lectura pública. Las funciones usan `SUPABASE_SERVICE_ROLE_KEY` en servidor.

## Subir imágenes

1. Entra a `/admin`.
2. Desbloquea con `ADMIN_PIN`.
3. En cada producto, usa **Subir imágenes**.
4. Formatos: `image/jpeg`, `image/png`, `image/webp`.
5. Tamaño máximo: 2 MB por archivo.
6. Máximo: 5 imágenes por producto.
7. Al eliminar una imagen, se borra el registro en `product_images` y se intenta borrar el archivo del bucket.

## Migración desde localStorage

Si el navegador tiene productos viejos en `localStorage`:

- Sin Supabase, el sitio sigue usando esos datos locales.
- Con Supabase configurado, el menú público prefiere Supabase.
- En `/admin` puedes usar **Migrar productos locales a Supabase**.
- La migración evita duplicados por `nombre + categoría`.

## Cómo probar que Supabase ya está conectado

1. En Netlify, configura todas las variables.
2. Ejecuta `supabase/schema.sql` en Supabase.
3. Haz deploy.
4. Abre el sitio público y revisa la consola: no debe aparecer el warning de fallback local.
5. Entra a `/admin`, escribe `ADMIN_PIN`, cambia disponibilidad o precio de un producto y recarga.
6. Confirma que el cambio permanece después de recargar y en otro navegador.
7. Sube una imagen a un producto y confirma que aparece en el menú público.
8. Agrega un producto al carrito y manda el pedido a WhatsApp para confirmar que el flujo no se rompió.

## Deploy en Netlify

El archivo `netlify.toml` ya trae el build y redirect SPA para que `/admin` funcione al refrescar:

- Build command: `npm run build`
- Publish directory: `dist`
