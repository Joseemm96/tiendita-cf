import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { getCloudflareEnv, getStoreSettings } from "@/lib/db";
import { formatMoney } from "@/lib/format";

type OrderPayload = {
  customer?: {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    deliveryMethod?: unknown;
    address?: unknown;
    notes?: unknown;
  };
  items?: Array<{ variantId?: unknown; quantity?: unknown }>;
};

type VariantOrderRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  product_price: number;
  variant_price: number | null;
  stock: number;
  track_inventory: number;
};

function clean(value: unknown, maximum: number) {
  return String(value ?? "").trim().slice(0, maximum);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isSameOrigin(request)) return json({ error: "Origen no permitido." }, 403);

  let payload: OrderPayload;
  try {
    payload = (await request.json()) as OrderPayload;
  } catch {
    return json({ error: "La información del pedido no es válida." }, 400);
  }

  const name = clean(payload.customer?.name, 100);
  const phone = clean(payload.customer?.phone, 30);
  const email = clean(payload.customer?.email, 160).toLowerCase();
  const deliveryMethod = payload.customer?.deliveryMethod === "pickup" ? "pickup" : "delivery";
  const address = clean(payload.customer?.address, 500);
  const notes = clean(payload.customer?.notes, 800);
  if (!name || !phone || (deliveryMethod === "delivery" && !address)) {
    return json({ error: "Completa tu nombre, teléfono y datos de entrega." }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "El correo electrónico no es válido." }, 400);
  }

  const requested = new Map<string, number>();
  for (const item of payload.items ?? []) {
    const variantId = clean(item.variantId, 80);
    const quantity = Math.max(1, Math.min(20, Math.trunc(Number(item.quantity) || 1)));
    if (variantId) requested.set(variantId, (requested.get(variantId) ?? 0) + quantity);
  }
  if (!requested.size || requested.size > 30 || [...requested.values()].some((quantity) => quantity > 20)) {
    return json({ error: "El carrito está vacío o contiene demasiados artículos." }, 400);
  }

  const { DB } = getCloudflareEnv(locals);
  const ids = [...requested.keys()];
  const placeholders = ids.map(() => "?").join(",");
  const result = await DB.prepare(
    `SELECT pv.id AS variant_id, pv.product_id, p.name AS product_name,
      pv.label AS variant_name, pv.sku, p.price_cents AS product_price,
      pv.price_cents AS variant_price, pv.stock, pv.track_inventory
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id IN (${placeholders}) AND pv.active = 1 AND p.active = 1`,
  )
    .bind(...ids)
    .all<VariantOrderRow>();

  if (result.results.length !== requested.size) {
    return json({ error: "Uno de los productos ya no está disponible." }, 409);
  }

  const unavailable = result.results.find((variant) => {
    const quantity = requested.get(variant.variant_id) ?? 0;
    return Boolean(variant.track_inventory && variant.stock < quantity);
  });
  if (unavailable) {
    return json({
      error: `Solo quedan ${unavailable.stock} unidades de ${unavailable.product_name} (${unavailable.variant_name}).`,
    }, 409);
  }

  const items = result.results.map((variant) => {
    const quantity = requested.get(variant.variant_id) ?? 0;
    const priceCents = variant.variant_price ?? variant.product_price;
    return { ...variant, quantity, priceCents, subtotalCents: priceCents * quantity };
  });

  const subtotalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
  const orderId = crypto.randomUUID();
  const orderNumber = `PED-${Date.now().toString(36).slice(-6).toUpperCase()}${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const settings = await getStoreSettings(DB);

  await DB.batch([
    DB.prepare(
      `INSERT INTO orders
       (id, number, customer_name, phone, customer_email, delivery_method, address, notes, subtotal_cents, total_cents, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(orderId, orderNumber, name, phone, email || null, deliveryMethod, address, notes, subtotalCents, subtotalCents, settings.currency),
    ...items.map((item) =>
      DB.prepare(
        `INSERT INTO order_items
         (id, order_id, product_id, variant_id, product_name, variant_name, sku, price_cents, quantity, subtotal_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), orderId, item.product_id, item.variant_id,
        item.product_name, item.variant_name, item.sku, item.priceCents,
        item.quantity, item.subtotalCents,
      ),
    ),
  ]);

  const itemLines = items.map(
    (item) => `• ${item.quantity} × ${item.product_name} — ${item.variant_name}\n  ${formatMoney(item.subtotalCents, settings.currency, settings.locale)}`,
  );
  const message = [
    `Hola, quiero confirmar la orden *${orderNumber}*`,
    "",
    ...itemLines,
    "",
    `*Total: ${formatMoney(subtotalCents, settings.currency, settings.locale)}*`,
    "",
    `Cliente: ${name}`,
    `Teléfono: ${phone}`,
    email ? `Correo: ${email}` : "",
    `Entrega: ${deliveryMethod === "pickup" ? "Retiro acordado" : address}`,
    notes ? `Notas: ${notes}` : "",
  ].filter(Boolean).join("\n");

  const whatsappNumber = settings.whatsappNumber.replace(/\D/g, "");
  return json({
    orderId,
    orderNumber,
    whatsappUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`,
  }, 201);
};
