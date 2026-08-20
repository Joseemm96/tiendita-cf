import type { APIRoute } from "astro";
import { getCloudflareEnv, getStoreSettings } from "@/lib/db";
import {
  createOrderReceiptPdf,
  type ReceiptItem,
  type ReceiptLogo,
  type ReceiptOrder,
} from "@/lib/receipt-pdf";

async function getReceiptLogo(bucket: R2Bucket, logoUrl: string): Promise<ReceiptLogo | null> {
  if (!logoUrl.startsWith("/media/")) return null;
  const object = await bucket.get(logoUrl.slice("/media/".length));
  if (!object) return null;
  const contentType = object.httpMetadata?.contentType ?? "";
  if (contentType !== "image/png" && contentType !== "image/jpeg" && contentType !== "image/jpg") return null;
  return { bytes: new Uint8Array(await object.arrayBuffer()), contentType };
}

export const GET: APIRoute = async ({ params, locals }) => {
  const id = params.id ?? "";
  const { DB, PRODUCT_IMAGES } = getCloudflareEnv(locals);
  const [order, items, settings] = await Promise.all([
    DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first<ReceiptOrder>(),
    DB.prepare("SELECT product_name, variant_name, sku, price_cents, quantity, subtotal_cents FROM order_items WHERE order_id = ? ORDER BY created_at, id").bind(id).all<ReceiptItem>(),
    getStoreSettings(DB),
  ]);

  if (!order) return new Response("Orden no encontrada", { status: 404 });
  const logo = await getReceiptLogo(PRODUCT_IMAGES, settings.logoUrl);
  const bytes = await createOrderReceiptPdf({ order, items: items.results, settings, logo });
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const filename = `recibo-${order.number.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
