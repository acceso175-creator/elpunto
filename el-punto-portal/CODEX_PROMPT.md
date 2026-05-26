# Prompt para Codex

Estoy trabajando en el portal de **El Punto — Desayunos To Go**. Es una app React + Vite lista para GitHub y Netlify.

Quiero que revises el proyecto y hagas mejoras sin romper el flujo actual.

## Contexto del producto

El portal debe permitir que un cliente:

1. Vea el menú de desayunos, birria y bebidas.
2. Elija productos.
3. Quite ingredientes de cada producto.
4. Seleccione cantidades y opciones.
5. Elija si el pedido es para recoger o a domicilio.
6. Capture dirección o comparta ubicación.
7. Elija método de pago: efectivo, tarjeta o transferencia.
8. Mande el pedido por WhatsApp con número de orden, detalle del pedido, método de pago y ubicación si aplica.
9. Opcionalmente cree una cuenta local para beneficios.

El panel admin debe permitir:

1. Agregar productos.
2. Quitar productos.
3. Cambiar precios.
4. Marcar productos como agotados o disponibles.
5. Cambiar el WhatsApp del negocio.
6. Ver métricas básicas.

## Restricción importante

La primera lista escrita en la hoja de notas donde dice “El Punto - Desayunos To Go” era solo un checklist interno de pendientes. No la conviertas en secciones del sitio ni la agregues como contenido visible.

## Mejoras que quiero que hagas

- Revisa si hay bugs de estado/localStorage.
- Mejora la estructura de componentes si hace falta.
- Mantén diseño responsive.
- Mantén el deploy compatible con Netlify.
- No agregues backend todavía, solo deja comentarios claros donde después se conectaría Supabase.
- Asegúrate de que el mensaje de WhatsApp sea claro y no duplique información.
- Agrega validaciones simples: nombre opcional, dirección requerida solo cuando sea domicilio, carrito obligatorio para enviar.
- Mantén el idioma en español.

## Stack actual

- React
- Vite
- CSS plano
- localStorage
- Netlify

## Resultado esperado

Entrega un PR con los cambios y explica brevemente qué modificaste, qué archivos tocaste y cómo probarlo localmente.
