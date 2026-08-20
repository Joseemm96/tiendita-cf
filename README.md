# Tiendita Cloudflare

Plantilla white-label de comercio conversacional construida con Astro y Cloudflare. Incluye catálogo, variantes, inventario, carrito, órdenes por WhatsApp y dashboard privado.

La demostración está configurada como una tienda de ropa, pero el modelo permite vender productos físicos o servicios. Los atributos de las variantes son libres: `talla`, `color`, `duración`, `modalidad`, `capacidad`, etc.

## Incluido

- Tienda responsive con filtros y búsqueda.
- Fichas de producto y variantes.
- Carrito persistente en `localStorage`.
- Checkout con validación de precios e inventario en el servidor.
- Creación de orden en D1 y mensaje de WhatsApp prellenado.
- Dashboard para productos, imágenes, variantes, inventario, órdenes y ajustes.
- Imágenes de productos y portada administrables en Cloudflare R2.
- Autenticación con cookie `HttpOnly` firmada mediante HMAC.
- Descuento de inventario al confirmar una orden y reposición al cancelarla.
- Importación y exportación del catálogo en CSV y Excel con validación previa.
- Actualización masiva de inventario por SKU.
- Sincronización manual y dos veces al día con una hoja de Google Sheets.
- Datos de demostración y cuatro productos de moda.

## Arquitectura

```text
Astro SSR en Cloudflare Workers
├── Tienda pública
├── APIs del checkout
├── Dashboard /admin
├── D1: catálogo, inventario, ajustes y órdenes
└── R2: imágenes cargadas desde el dashboard
```

## Desarrollo local

Requisitos: Node.js 22 o posterior y una cuenta gratuita de Cloudflare.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Edita `.dev.vars` y establece una contraseña y un secreto largo:

```dotenv
ADMIN_PASSWORD="una-clave-segura"
SESSION_SECRET="un-valor-aleatorio-de-al-menos-32-caracteres"
GOOGLE_SERVICE_ACCOUNT_JSON=""
GOOGLE_SHEET_ID=""
```

La tienda queda disponible en `http://localhost:4321` y el dashboard en `http://localhost:4321/admin`.

## Preparar Cloudflare

Autentica Wrangler y crea los recursos:

```bash
npx wrangler login
npx wrangler d1 create tiendita-db
npx wrangler r2 bucket create tiendita-product-images
```

El primer comando de D1 devuelve un `database_id`. Reemplaza `REPLACE_WITH_D1_DATABASE_ID` en `wrangler.jsonc` por ese identificador.

Aplica el esquema y carga los datos de demostración:

```bash
npm run db:migrate:remote
```

Guarda las credenciales del dashboard como secretos del Worker:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

Los secretos de Google son opcionales. La tienda y la importación CSV/Excel funcionan sin ellos.

Finalmente despliega:

```bash
npm run deploy
```

El proyecto funcionará en el subdominio gratuito `*.workers.dev`. Un dominio propio puede asociarse desde **Workers & Pages → tiendita-template → Settings → Domains & Routes**.

## Personalizar para otro cliente

La mayoría de los cambios se realizan en `/admin/ajustes`:

- nombre de la marca;
- logo opcional de la tienda;
- frase y descripción;
- título, subtítulo e imagen del hero;
- número de WhatsApp;
- enlaces activables de Instagram, Facebook y WhatsApp;
- correo;
- moneda y región;
- color principal;
- anuncio superior.

Los valores iniciales se encuentran en `src/config/store.ts`. El diseño general vive en `src/styles/global.css` y las ilustraciones de demostración en `public/placeholders/`.

### Cambiar las tipografías

Las fuentes se controlan al inicio de `src/styles/global.css`:

- La primera línea importa **DM Sans** y **Manrope** desde Google Fonts.
- `--font-body` define la fuente de textos, botones y formularios.
- `--font-heading` define títulos y el nombre de la tienda.

Para usar otras fuentes de Google, sustituye el `@import` y actualiza esas dos variables. Para usar archivos propios, se recomienda el formato `.woff2`:

1. Crea la carpeta `public/fonts/`.
2. Copia allí los archivos, por ejemplo `MiFuente-Regular.woff2`.
3. Elimina el `@import` de Google Fonts.
4. Declara la fuente antes de `:root` y úsala en las variables:

```css
@font-face {
  font-family: "Mi Fuente";
  src: url("/fonts/MiFuente-Regular.woff2") format("woff2");
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-body: "Mi Fuente", sans-serif;
  --font-heading: "Mi Fuente", sans-serif;
}
```

### Iniciales y favicon

El icono del dashboard y el favicon se generan automáticamente a partir del nombre de la tienda. Por ejemplo, **Línea Base** produce `LB` y **Tienda Norte** produce `TN`. También utilizan el color principal configurado en el dashboard.

Esta lógica vive en `src/lib/brand.ts`. Si prefieres un favicon diseñado manualmente:

1. Guarda el archivo en `public/favicon.svg` o `public/favicon.png`.
2. En `src/layouts/BaseLayout.astro` y `src/layouts/AdminLayout.astro`, reemplaza `href={favicon}` por `href="/favicon.svg"` —o la ruta del PNG—.
3. Ajusta también el atributo `type` cuando uses PNG: `image/png`.

### Logo de la tienda

El logo se configura desde **Dashboard → Ajustes → Identidad de la tienda**. Puedes subir un archivo a R2 o indicar una URL externa.

- Formatos de subida: JPEG, PNG, WebP y AVIF.
- Tamaño máximo: 5 MB.
- Para conservar transparencia se recomienda PNG o WebP.
- El mismo logo aparece en el header, footer, acceso y navegación del dashboard.
- Si no se configura un logo, se muestra automáticamente el nombre de la tienda.
- En el dashboard, el icono compacto vuelve a utilizar las iniciales calculadas desde el nombre.
- Puedes marcar **Eliminar logo** y guardar para regresar al fallback textual.

La URL se guarda como `logo_url` en D1. Los archivos cargados se almacenan bajo `settings/logo/` en el bucket R2 `PRODUCT_IMAGES`.

### Variantes de producto

Cada variante se escribe en una línea separada dentro del campo **Variantes**. Los cuatro grupos de información se separan con `|`:

```text
Etiqueta visible | SKU único | Stock | atributo=valor, atributo=valor
```

Ejemplo para una prenda disponible en varias tallas y colores:

```text
S · Negro | CAM-NEG-S | 8 | talla=S, color=Negro
M · Negro | CAM-NEG-M | 5 | talla=M, color=Negro
M · Blanco | CAM-BLA-M | 3 | talla=M, color=Blanco
```

- **Etiqueta visible:** opción que verá el cliente en la ficha del producto.
- **SKU:** identificador único de inventario. No debe repetirse entre variantes ni productos.
- **Stock:** número entero de unidades disponibles.
- **Atributos:** información estructurada separada por comas. Cada atributo utiliza `nombre=valor`.

Puedes utilizar otros atributos según el negocio, por ejemplo `duración=60 minutos`, `modalidad=Online` o `capacidad=10 personas`. Al editar un producto, las líneas eliminadas del campo dejan sus variantes inactivas. El precio configurado en el formulario se aplica actualmente a todas sus variantes.

### Importar y exportar productos

En **Dashboard → Productos** puedes exportar el catálogo completo como CSV o Excel y abrir el asistente de importación. El asistente valida el archivo y muestra productos, variantes y errores antes de guardar cualquier cambio.

La plantilla completa usa una fila por SKU. Para ajustes rápidos también hay una plantilla de inventario con solo dos columnas:

```csv
sku,stock
LIN-ARE-S,8
LIN-ARE-M,12
```

- El SKU es único y se utiliza para localizar variantes existentes.
- Los IDs se incluyen en las exportaciones; déjalos vacíos para crear registros nuevos.
- Omitir una variante no la elimina. Usa `variant_active=false` para ocultarla.
- Las imágenes se representan con URLs separadas por `|`. Una celda vacía conserva las imágenes existentes.
- Cada importación admite hasta 500 filas y archivos de 5 MB.
- Los cambios se ejecutan en un lote transaccional de D1.

### Google Sheets para consultar el inventario

La integración mantiene D1 como fuente oficial y publica una copia de consulta en una pestaña llamada **Inventario**. El botón **Sincronizar ahora** está en **Dashboard → Productos**. También se ejecuta automáticamente a las 8:00 a. m. y 6:00 p. m. de Caracas mediante un único Cron Trigger (`0 12,22 * * *`).

Para configurarla:

1. Crea un proyecto en Google Cloud y habilita **Google Sheets API**.
2. Crea una cuenta de servicio y descarga su credencial JSON.
3. Crea una hoja de Google Sheets vacía y compártela con el `client_email` de la cuenta de servicio como editor.
4. Copia el identificador que aparece entre `/d/` y `/edit` en la URL de la hoja.
5. Guarda ambos valores como secretos del Worker:

```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
npx wrangler secret put GOOGLE_SHEET_ID
```

En el primer comando pega el contenido completo del JSON. En el segundo pega solamente el ID de la hoja. La aplicación crea automáticamente la pestaña **Inventario** si todavía no existe.

Para desarrollo local puedes colocar esos valores en `.dev.vars`. Si permanecen vacíos, el botón aparece desactivado y el cron omite la sincronización sin modificar el catálogo.

### Sesión del dashboard

Después de iniciar sesión correctamente, el dashboard guarda una cookie firmada durante **7 días**, por lo que no es necesario escribir la contraseña en cada visita.

- La cookie es `HttpOnly`, utiliza `SameSite=Strict` y en producción se envía únicamente por HTTPS.
- La contraseña nunca se guarda en el navegador.
- La sesión termina al pulsar **Cerrar sesión**, eliminar las cookies, cambiar `SESSION_SECRET` o cumplir los 7 días.
- La duración se controla con `ADMIN_SESSION_DURATION` en `src/lib/auth.ts`.

Si cambias la duración, vuelve a desplegar el Worker. Las sesiones creadas anteriormente conservan su fecha de expiración original.

### Varias imágenes por producto

El formulario de productos permite subir varias imágenes simultáneamente a R2 o agregar varias URLs, colocando una URL por línea.

- Máximo de 10 imágenes por producto.
- Cada archivo puede pesar hasta 5 MB.
- Formatos permitidos: JPEG, PNG, WebP y AVIF.
- La primera imagen disponible funciona como portada en el catálogo y el carrito.
- Las demás aparecen como miniaturas navegables en la ficha del producto.
- Al editar, las imágenes existentes se conservan salvo que marques **Eliminar**.
- Las imágenes nuevas se agregan al final de la galería.

Las referencias y su orden se guardan en la tabla D1 `product_images`; los archivos subidos se almacenan en el bucket R2 configurado como `PRODUCT_IMAGES`.

Para crear una instalación nueva para otro cliente:

1. Duplica el repositorio.
2. Cambia el nombre del Worker, D1 y R2 en `wrangler.jsonc`.
3. Crea recursos Cloudflare independientes.
4. Cambia los secretos del administrador.
5. Ejecuta la migración y personaliza la marca desde el dashboard.

Así, cada cliente mantiene aislados sus productos, órdenes, imágenes y credenciales.

## Flujo de inventario

Crear el mensaje de WhatsApp no descuenta existencias. La orden entra como `pending` y el inventario se descuenta únicamente cuando el negocio la cambia a `confirmed`.

- `pending → confirmed`: descuenta inventario.
- `confirmed → cancelled`: repone inventario.
- `confirmed → delivered`: mantiene el inventario descontado.
- Una orden entregada o cancelada no puede reabrirse desde el dashboard.

La validación y el cambio de stock se ejecutan dentro de D1 mediante triggers, evitando confirmar una orden si ya no hay unidades suficientes.

## Consideraciones de producción

- Sustituye el número de WhatsApp de demostración antes de publicar.
- Usa una contraseña única y un secreto aleatorio largo.
- Optimiza las imágenes antes de subirlas; el endpoint acepta JPEG, PNG, WebP y AVIF de hasta 5 MB.
- El enlace de WhatsApp prepara el mensaje, pero el cliente todavía debe pulsar **Enviar**.
- Para notificaciones automáticas o estados conversacionales será necesaria la API oficial de WhatsApp Business.
- Antes de aceptar pagos en línea deberán añadirse políticas comerciales, impuestos, envíos y una pasarela de pago apropiada al país.
