import { storeDefaults, type StoreSettings } from "@/config/store";
import type { Category, Product, ProductImage, ProductVariant } from "./types";
import { env } from "cloudflare:workers";

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  item_type: "physical" | "service";
  price_cents: number;
  compare_at_cents: number | null;
  active: number;
  featured: number;
};

type ImageRow = {
  id: string;
  product_id: string;
  url: string;
  alt: string | null;
  position: number;
};

type VariantRow = {
  id: string;
  product_id: string;
  label: string;
  sku: string;
  attributes_json: string | null;
  price_cents: number | null;
  stock: number;
  track_inventory: number;
  active: number;
};

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  active: number;
};

export function getCloudflareEnv(_locals?: App.Locals) {
  return env as CloudflareEnv;
}

function hydrateProducts(
  rows: ProductRow[],
  images: ImageRow[],
  variants: VariantRow[],
): Product[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    categoryId: row.category_id,
    categoryName: row.category_name,
    itemType: row.item_type,
    priceCents: row.price_cents,
    compareAtCents: row.compare_at_cents,
    active: Boolean(row.active),
    featured: Boolean(row.featured),
    images: images
      .filter((image) => image.product_id === row.id)
      .map<ProductImage>((image) => ({
        id: image.id,
        url: image.url,
        alt: image.alt ?? row.name,
        position: image.position,
      })),
    variants: variants
      .filter((variant) => variant.product_id === row.id)
      .map<ProductVariant>((variant) => ({
        id: variant.id,
        productId: variant.product_id,
        label: variant.label,
        sku: variant.sku,
        attributes: safeJson(variant.attributes_json),
        priceCents: variant.price_cents,
        stock: variant.stock,
        trackInventory: Boolean(variant.track_inventory),
        active: Boolean(variant.active),
      })),
  }));
}

function safeJson(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function listProducts(db: D1Database, includeInactive = false) {
  const condition = includeInactive ? "1 = 1" : "p.active = 1";
  const [productsResult, imagesResult, variantsResult] = await db.batch([
    db.prepare(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${condition}
       ORDER BY p.featured DESC, p.created_at DESC`,
    ),
    db.prepare("SELECT * FROM product_images ORDER BY position ASC"),
    db.prepare(
      `SELECT * FROM product_variants
       ${includeInactive ? "" : "WHERE active = 1"}
       ORDER BY label ASC`,
    ),
  ]);

  return hydrateProducts(
    productsResult.results as unknown as ProductRow[],
    imagesResult.results as unknown as ImageRow[],
    variantsResult.results as unknown as VariantRow[],
  );
}

export async function getProductBySlug(db: D1Database, slug: string) {
  const products = await getProductsByWhere(db, "p.slug = ? AND p.active = 1", [slug]);
  return products[0] ?? null;
}

export async function getProductById(db: D1Database, id: string) {
  const products = await getProductsByWhere(db, "p.id = ?", [id]);
  return products[0] ?? null;
}

async function getProductsByWhere(
  db: D1Database,
  where: string,
  bindings: unknown[],
) {
  const productResult = await db
    .prepare(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where}`,
    )
    .bind(...bindings)
    .all<ProductRow>();

  if (!productResult.results.length) return [];
  const ids = productResult.results.map((product) => product.id);
  const placeholders = ids.map(() => "?").join(",");
  const [imagesResult, variantsResult] = await db.batch([
    db
      .prepare(
        `SELECT * FROM product_images WHERE product_id IN (${placeholders}) ORDER BY position`,
      )
      .bind(...ids),
    db
      .prepare(
        `SELECT * FROM product_variants WHERE product_id IN (${placeholders}) ORDER BY label`,
      )
      .bind(...ids),
  ]);

  return hydrateProducts(
    productResult.results,
    imagesResult.results as unknown as ImageRow[],
    variantsResult.results as unknown as VariantRow[],
  );
}

export async function listCategories(db: D1Database, includeInactive = false) {
  const result = await db
    .prepare(
      `SELECT id, name, slug, sort_order, active
       FROM categories
       ${includeInactive ? "" : "WHERE active = 1"}
       ORDER BY sort_order, name`,
    )
    .all<CategoryRow>();
  return result.results.map<Category>((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sort_order,
    active: Boolean(category.active),
  }));
}

export async function getStoreSettings(db: D1Database): Promise<StoreSettings> {
  const result = await db.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string;
  }>();
  const values = Object.fromEntries(result.results.map((item) => [item.key, item.value]));

  return {
    brandName: values.brand_name || storeDefaults.brandName,
    logoUrl: values.logo_url || storeDefaults.logoUrl,
    tagline: values.tagline || storeDefaults.tagline,
    description: values.description || storeDefaults.description,
    heroTitle: values.hero_title || storeDefaults.heroTitle,
    heroSubtitle: values.hero_subtitle || storeDefaults.heroSubtitle,
    heroImageUrl: values.hero_image_url || storeDefaults.heroImageUrl,
    loginImageUrl: values.login_image_url || storeDefaults.loginImageUrl,
    whatsappNumber: values.whatsapp_number || storeDefaults.whatsappNumber,
    whatsappActive: values.whatsapp_active === undefined
      ? storeDefaults.whatsappActive
      : values.whatsapp_active === "1",
    instagramUrl: values.instagram_url || storeDefaults.instagramUrl,
    instagramActive: values.instagram_active === undefined
      ? storeDefaults.instagramActive
      : values.instagram_active === "1",
    facebookUrl: values.facebook_url || storeDefaults.facebookUrl,
    facebookActive: values.facebook_active === undefined
      ? storeDefaults.facebookActive
      : values.facebook_active === "1",
    currency: values.currency || storeDefaults.currency,
    locale: values.locale || storeDefaults.locale,
    accentColor: values.accent_color || storeDefaults.accentColor,
    supportEmail: values.support_email || storeDefaults.supportEmail,
    announcement: values.announcement || storeDefaults.announcement,
  };
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}
