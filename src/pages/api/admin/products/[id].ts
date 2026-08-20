import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { getCloudflareEnv } from "@/lib/db";
import { parseMoney } from "@/lib/format";
import { parseVariants, saveProductImages } from "./index";

type CurrentImage = { id: string; object_key: string | null; position: number };

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Origen no permitido", { status: 403 });
  const id = params.id ?? "";
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const description = String(form.get("description") ?? "").trim().slice(0, 2500);
  if (!id || !name || !description) return new Response("Datos incompletos", { status: 400 });

  try {
    const { DB, PRODUCT_IMAGES } = getCloudflareEnv(locals);
    const variants = parseVariants(form.get("variants"));
    if (!variants.length) throw new Error("Agrega al menos una variante.");
    const currentVariants = await DB.prepare("SELECT id, sku FROM product_variants WHERE product_id = ?").bind(id).all<{ id: string; sku: string }>();
    const currentImages = await DB.prepare(
      "SELECT id, object_key, position FROM product_images WHERE product_id = ? ORDER BY position",
    ).bind(id).all<CurrentImage>();
    const requestedRemovals = new Set(form.getAll("removeImageIds").map(String));
    const removedImages = currentImages.results.filter((image) => requestedRemovals.has(image.id));
    const remainingImages = currentImages.results.filter((image) => !requestedRemovals.has(image.id));
    const newFileCount = form.getAll("images").filter((entry) => entry instanceof File && entry.size > 0).length;
    const newUrlCount = String(form.get("imageUrls") ?? "").split(/\r?\n/).filter((url) => url.trim()).length;
    if (remainingImages.length + newFileCount + newUrlCount > 10) {
      throw new Error("Un producto puede tener un máximo de 10 imágenes.");
    }
    const newImages = await saveProductImages(PRODUCT_IMAGES, form.getAll("images"), form.get("imageUrls"));
    const idsBySku = new Map(currentVariants.results.map((variant) => [variant.sku, variant.id]));
    const trackInventory = form.has("trackInventory");
    const compareAtCents = form.get("compareAt") ? parseMoney(form.get("compareAt")) : null;
    const nextImagePosition = remainingImages.reduce((max, image) => Math.max(max, image.position), -1) + 1;
    const removeStatement = removedImages.length
      ? DB.prepare(`DELETE FROM product_images WHERE product_id = ? AND id IN (${removedImages.map(() => "?").join(",")})`).bind(id, ...removedImages.map((image) => image.id))
      : null;

    await DB.batch([
      DB.prepare(
        `UPDATE products SET name = ?, description = ?, category_id = ?, item_type = ?, price_cents = ?, compare_at_cents = ?, active = ?, featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(name, description, String(form.get("categoryId") || "") || null, form.get("itemType") === "service" ? "service" : "physical", parseMoney(form.get("price")), compareAtCents, form.has("active") ? 1 : 0, form.has("featured") ? 1 : 0, id),
      DB.prepare("UPDATE product_variants SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?").bind(id),
      DB.prepare("UPDATE product_images SET alt = ? WHERE product_id = ?").bind(name, id),
      ...(removeStatement ? [removeStatement] : []),
      ...newImages.map((image, index) => DB.prepare(
        "INSERT INTO product_images (id, product_id, object_key, url, alt, position) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), id, image.objectKey, image.url, name, nextImagePosition + index)),
      ...variants.map((variant) => {
        const variantId = idsBySku.get(variant.sku) ?? crypto.randomUUID();
        return DB.prepare(
          `INSERT INTO product_variants (id, product_id, label, sku, attributes_json, stock, track_inventory, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET label = excluded.label, sku = excluded.sku, attributes_json = excluded.attributes_json, stock = excluded.stock, track_inventory = excluded.track_inventory, active = 1, updated_at = CURRENT_TIMESTAMP`,
        ).bind(variantId, id, variant.label, variant.sku, JSON.stringify(variant.attributes), variant.stock, trackInventory ? 1 : 0);
      }),
    ]);
    await Promise.allSettled(
      removedImages.filter((image) => image.object_key).map((image) => PRODUCT_IMAGES.delete(image.object_key!)),
    );
    return redirect("/admin/productos", 303);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "No fue posible actualizar el producto.", { status: 400 });
  }
};
