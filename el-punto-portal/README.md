# El Punto — Desayunos To Go

Portal MVP para tomar pedidos por WhatsApp, pensado para modificarse con Codex, subirse a GitHub y desplegarse en Netlify.

## Qué incluye

- Menú dividido en Desayunos, Birria y Bebidas.
- Productos con ingredientes removibles.
- Selección de cantidad y opciones por producto.
- Carrito de pedido.
- Pedido para recoger o a domicilio.
- Captura de dirección y ubicación con navegador.
- Mensaje automático a WhatsApp con número de orden, pedido, método de pago y ubicación.
- Panel Admin local para:
  - cambiar número de WhatsApp,
  - cambiar datos del negocio,
  - poner productos como disponibles o agotados,
  - agregar productos,
  - quitar productos,
  - cambiar precios,
  - ver métricas básicas locales.
- Cuenta rápida de cliente / beneficios.

## Importante

Esta versión es un MVP sin backend. El Admin y las métricas usan `localStorage`, así que no son seguridad ni analítica real. Para producción conviene conectar:

- Supabase para usuarios, admin, menú y pedidos.
- Google Analytics, Plausible o PostHog para métricas reales.
- Netlify Forms, Supabase o webhook/n8n si quieres guardar cada pedido aparte de WhatsApp.

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
6. Deploy.

El archivo `netlify.toml` ya trae esa configuración.

## Admin demo

PIN local: `1234`

Cámbialo cuando se conecte backend. No lo uses como seguridad real.

## Dónde editar el menú inicial

Archivo:

```txt
src/menuData.js
```

También se puede editar desde el panel Admin, pero esos cambios quedan guardados solo en el navegador.

## Siguiente mejora recomendada

La versión 2 debería conectar Supabase para tener:

- menú persistente real,
- login de admin,
- cuentas de cliente,
- historial de pedidos,
- métricas reales,
- cupones/beneficios por usuario.
