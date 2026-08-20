import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { getCloudflareEnv } from "@/lib/db";
import { parseMoney, slugify } from "@/lib/format";

type ParsedVariant = { label: string; sku: string; stock: number; attributes: Record<string, string> };

export function parseVariants(value: FormDataEntryValue | null): ParsedVariant[] {
  const seen = new Set<string>();
  return String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [rawLabel, rawSku, rawStock, rawAttributes = ""] = line.split("|").map((part) => part.trim());
    const label = rawLabel || "Única";
    const sku = rawSku || `SKU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    if (seen.has(sku)) throw new Error(`El SKU ${sku} está repetido.`);
    seen.add(sku);
    const attributes: Record<string, string> = {};
    rawAttributes.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => {
      const [key, ...rest] = item.split("=");
      if (key?.trim() && rest.length) attributes[key.trim()] = rest.join("=").trim();
    });
    return { label, sku, stock: Math.max(0, Number.parseInt(rawStock || "0", 10) || 0), attributes };
  });
}

export async function saveProductImage(
  bucket: R2Bucket,
  file: FormDataEntryValue | null,
  imageUrl: FormDataEntryValue | null,
) {
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) throw new Error("La imagen supera el máximo de 5 MB.");
    if (!new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]).has(file.type)) {
      throw new Error("Usa una imagen JPEG, PNG, WebP o AVIF.");
    }
    const extension = file.type.split("/")[1].replace("jpeg", "jpg");
    const key = `products/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${extension}`;
    await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    return { url: `/media/${key}`, objectKey: key };
  }
  const url = String(imageUrl ?? "").trim();
  if (url) {
    const parsed = new URL(url);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("La URL de imagen no es válida.");
    return { url, objectKey: null };
  }
  return null;
}

export async function saveProductImages(
  bucket: R2Bucket,
  files: FormDataEntryValue[],
  imageUrls: FormDataEntryValue | null,
) {
  const selectedFiles = files.filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const urls = String(imageUrls ?? "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
  if (selectedFiles.length + urls.length > 10) {
    throw new Error("Puedes agregar un máximo de 10 imágenes por producto.");
  }

  const saved = await Promise.all([
    ...selectedFiles.map((file) => saveProductImage(bucket, file, null)),
    ...urls.map((url) => saveProductImage(bucket, null, url)),
  ]);
  return saved.filter((image): image is { url: string; objectKey: string | null } => Boolean(image));
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Origen no permitido", { status: 403 });
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const description = String(form.get("description") ?? "").trim().slice(0, 2500);
  const priceCents = parseMoney(form.get("price"));
  if (!name || !description || priceCents < 0) return new Response("Datos incompletos", { status: 400 });

  try {
    const { DB, PRODUCT_IMAGES } = getCloudflareEnv(locals);
    const id = crypto.randomUUID();
    let slug = slugify(name) || id.slice(0, 8);
    const existing = await DB.prepare("SELECT id FROM products WHERE slug = ?").bind(slug).first();
    if (existing) slug = `${slug}-${id.slice(0, 5)}`;
    const variants = parseVariants(form.get("variants"));
    if (!variants.length) throw new Error("Agrega al menos una variante.");
    const images = await saveProductImages(PRODUCT_IMAGES, form.getAll("images"), form.get("imageUrls"));
    const trackInventory = form.has("trackInventory");
    const compareAtCents = form.get("compareAt") ? parseMoney(form.get("compareAt")) : null;

    await DB.batch([
      DB.prepare(
        `INSERT INTO products (id, name, slug, description, category_id, item_type, price_cents, compare_at_cents, active, featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, name, slug, description, String(form.get("categoryId") || "") || null, form.get("itemType") === "service" ? "service" : "physical", priceCents, compareAtCents, form.has("active") ? 1 : 0, form.has("featured") ? 1 : 0),
      ...images.map((image, position) => DB.prepare(
        "INSERT INTO product_images (id, product_id, object_key, url, alt, position) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), id, image.objectKey, image.url, name, position)),
      ...variants.map((variant) => DB.prepare(
        `INSERT INTO product_variants (id, product_id, label, sku, attributes_json, stock, track_inventory)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, variant.label, variant.sku, JSON.stringify(variant.attributes), variant.stock, trackInventory ? 1 : 0)),
    ]);
    return redirect("/admin/productos", 303);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "No fue posible crear el producto.", { status: 400 });
  }
};
