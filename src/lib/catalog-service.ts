import {
  CATALOG_SCHEMA_VERSION,
  emptyCatalogRow,
  fallbackSlug,
  type CatalogImportMode,
  type CatalogRow,
  type ParsedCatalogFile,
} from "./catalog-schema";

type ProductDbRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category_id: string | null;
  category_slug: string | null;
  item_type: "physical" | "service";
  price_cents: number;
  compare_at_cents: number | null;
  active: number;
  featured: number;
};

type VariantDbRow = {
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

type ImageDbRow = {
  id: string;
  product_id: string;
  object_key: string | null;
  url: string;
  alt: string | null;
  position: number;
};

type CategoryDbRow = { id: string; slug: string };

export type CatalogImportIssue = {
  row: number;
  field: string;
  message: string;
};

export type CatalogImportPreview = {
  mode: CatalogImportMode;
  totalRows: number;
  createdProducts: number;
  updatedProducts: number;
  createdVariants: number;
  updatedVariants: number;
  errors: CatalogImportIssue[];
  warnings: string[];
};

type PreparedProduct = {
  sourceRow: number;
  id: string;
  exists: boolean;
  name: string;
  slug: string;
  description: string;
  categoryId: string | null;
  itemType: "physical" | "service";
  priceCents: number;
  compareAtCents: number | null;
  active: boolean;
  featured: boolean;
  imageUrls: string[];
  currentImages: ImageDbRow[];
};

type PreparedVariant = {
  sourceRow: number;
  id: string;
  productId: string;
  exists: boolean;
  label: string;
  sku: string;
  attributes: Record<string, string>;
  priceCents: number | null;
  stock: number;
  trackInventory: boolean;
  active: boolean;
};

export type PreparedCatalogImport = {
  preview: CatalogImportPreview;
  products: PreparedProduct[];
  variants: PreparedVariant[];
};

function money(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function attributesToText(value: string | null) {
  if (!value) return "";
  try {
    const attributes = JSON.parse(value) as Record<string, unknown>;
    return Object.entries(attributes).map(([key, item]) => `${key}=${String(item)}`).join(";");
  } catch {
    return "";
  }
}

export async function exportCatalogRows(db: D1Database): Promise<CatalogRow[]> {
  const [productsResult, variantsResult, imagesResult] = await db.batch([
    db.prepare(
      `SELECT p.*, c.slug AS category_slug
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.created_at, p.id`,
    ),
    db.prepare("SELECT * FROM product_variants ORDER BY product_id, created_at, id"),
    db.prepare("SELECT * FROM product_images ORDER BY product_id, position, id"),
  ]);
  const products = productsResult.results as unknown as ProductDbRow[];
  const variants = variantsResult.results as unknown as VariantDbRow[];
  const images = imagesResult.results as unknown as ImageDbRow[];

  return products.flatMap((product) => {
    const productVariants = variants.filter((variant) => variant.product_id === product.id);
    const imageUrls = images.filter((image) => image.product_id === product.id).map((image) => image.url).join("|");
    return productVariants.map<CatalogRow>((variant) => ({
      ...emptyCatalogRow(),
      schema_version: CATALOG_SCHEMA_VERSION,
      product_id: product.id,
      slug: product.slug,
      product_name: product.name,
      description: product.description ?? "",
      category_slug: product.category_slug ?? "",
      item_type: product.item_type,
      product_price: money(product.price_cents),
      compare_at_price: money(product.compare_at_cents),
      product_active: Boolean(product.active) ? "true" : "false",
      featured: Boolean(product.featured) ? "true" : "false",
      variant_id: variant.id,
      sku: variant.sku,
      variant_label: variant.label,
      attributes: attributesToText(variant.attributes_json),
      variant_price: money(variant.price_cents),
      stock: String(variant.stock),
      track_inventory: Boolean(variant.track_inventory) ? "true" : "false",
      variant_active: Boolean(variant.active) ? "true" : "false",
      image_urls: imageUrls,
    }));
  });
}

function parseBoolean(value: string, fallback: boolean) {
  if (!value.trim()) return fallback;
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (["true", "1", "si", "yes", "activo"].includes(normalized)) return true;
  if (["false", "0", "no", "inactivo"].includes(normalized)) return false;
  return null;
}

function parseCents(value: string, required: boolean) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return required ? Number.NaN : null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
}

function parseStock(value: string) {
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
}

function parseAttributes(value: string) {
  const attributes: Record<string, string> = {};
  for (const item of value.split(/[;,]/).map((part) => part.trim()).filter(Boolean)) {
    const [rawKey, ...rawValue] = item.split("=");
    const key = rawKey?.trim();
    const attributeValue = rawValue.join("=").trim();
    if (!key || !attributeValue) return null;
    attributes[key] = attributeValue;
  }
  return attributes;
}

function parseImageUrls(value: string) {
  const urls = value.split(/\||\r?\n/).map((url) => url.trim()).filter(Boolean);
  if (urls.length > 10) return null;
  for (const url of urls) {
    if (url.startsWith("/")) continue;
    try {
      if (!new Set(["http:", "https:"]).has(new URL(url).protocol)) return null;
    } catch {
      return null;
    }
  }
  return [...new Set(urls)];
}

function firstValue(rows: { values: Record<string, string> }[], field: string) {
  return rows.map((row) => row.values[field]?.trim() ?? "").find(Boolean) ?? "";
}

function conflictingValue(rows: { values: Record<string, string> }[], field: string) {
  const values = [...new Set(rows.map((row) => row.values[field]?.trim() ?? "").filter(Boolean))];
  return values.length > 1;
}

function issue(errors: CatalogImportIssue[], row: number, field: string, message: string) {
  errors.push({ row, field, message });
}

export async function prepareCatalogImport(
  db: D1Database,
  parsed: ParsedCatalogFile,
): Promise<PreparedCatalogImport> {
  const [productsResult, variantsResult, categoriesResult, imagesResult] = await db.batch([
    db.prepare("SELECT id, slug FROM products"),
    db.prepare("SELECT id, product_id, sku FROM product_variants"),
    db.prepare("SELECT id, slug FROM categories"),
    db.prepare("SELECT id, product_id, object_key, url, alt, position FROM product_images ORDER BY position"),
  ]);
  const existingProducts = productsResult.results as unknown as Pick<ProductDbRow, "id" | "slug">[];
  const existingVariants = variantsResult.results as unknown as Pick<VariantDbRow, "id" | "product_id" | "sku">[];
  const categories = categoriesResult.results as unknown as CategoryDbRow[];
  const currentImages = imagesResult.results as unknown as ImageDbRow[];
  const productsById = new Map(existingProducts.map((product) => [product.id, product]));
  const productsBySlug = new Map(existingProducts.map((product) => [product.slug, product]));
  const variantsById = new Map(existingVariants.map((variant) => [variant.id, variant]));
  const variantsBySku = new Map(existingVariants.map((variant) => [variant.sku, variant]));
  const categoriesBySlug = new Map(categories.map((category) => [category.slug, category.id]));
  const errors: CatalogImportIssue[] = [];
  const warnings: string[] = [];
  const products: PreparedProduct[] = [];
  const variants: PreparedVariant[] = [];

  if (parsed.mode === "inventory") {
    const seenSkus = new Set<string>();
    for (const row of parsed.rows) {
      const sku = row.values.sku?.trim() ?? "";
      const stock = parseStock(row.values.stock ?? "");
      if (!sku) issue(errors, row.rowNumber, "sku", "El SKU es obligatorio.");
      if (seenSkus.has(sku)) issue(errors, row.rowNumber, "sku", `El SKU ${sku} está repetido en el archivo.`);
      seenSkus.add(sku);
      if (!Number.isFinite(stock)) issue(errors, row.rowNumber, "stock", "El stock debe ser un entero mayor o igual a cero.");
      const existing = variantsBySku.get(sku);
      if (sku && !existing) issue(errors, row.rowNumber, "sku", `No existe una variante con el SKU ${sku}.`);
      if (existing && Number.isFinite(stock)) {
        variants.push({
          sourceRow: row.rowNumber,
          id: existing.id,
          productId: existing.product_id,
          exists: true,
          label: "",
          sku,
          attributes: {},
          priceCents: null,
          stock,
          trackInventory: true,
          active: true,
        });
      }
    }
  } else {
    const groups = new Map<string, typeof parsed.rows>();
    for (const row of parsed.rows) {
      const productId = row.values.product_id?.trim() ?? "";
      const slug = row.values.slug?.trim() || fallbackSlug(row.values.product_name?.trim() ?? "");
      const key = productId ? `id:${productId}` : `slug:${slug}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const usedSlugs = new Map<string, string>();
    const seenSkus = new Set<string>();
    for (const groupRows of groups.values()) {
      const sourceRow = groupRows[0].rowNumber;
      for (const field of [
        "product_id", "slug", "product_name", "description", "category_slug", "item_type",
        "product_price", "compare_at_price", "product_active", "featured", "image_urls",
      ]) {
        if (conflictingValue(groupRows, field)) {
          issue(errors, sourceRow, field, `El producto tiene valores distintos para ${field}.`);
        }
      }

      const requestedId = firstValue(groupRows, "product_id");
      const name = firstValue(groupRows, "product_name");
      const slug = firstValue(groupRows, "slug") || fallbackSlug(name);
      const description = firstValue(groupRows, "description");
      const categorySlug = firstValue(groupRows, "category_slug");
      const itemTypeValue = firstValue(groupRows, "item_type") || "physical";
      const priceCents = parseCents(firstValue(groupRows, "product_price"), true);
      const compareAtCents = parseCents(firstValue(groupRows, "compare_at_price"), false);
      const active = parseBoolean(firstValue(groupRows, "product_active"), true);
      const featured = parseBoolean(firstValue(groupRows, "featured"), false);
      const imageUrls = parseImageUrls(firstValue(groupRows, "image_urls"));

      if (!name) issue(errors, sourceRow, "product_name", "El nombre del producto es obligatorio.");
      if (!description) issue(errors, sourceRow, "description", "La descripción del producto es obligatoria.");
      if (!new Set(["physical", "service"]).has(itemTypeValue)) {
        issue(errors, sourceRow, "item_type", "El tipo debe ser physical o service.");
      }
      if (!Number.isFinite(priceCents)) issue(errors, sourceRow, "product_price", "Usa un precio válido con máximo dos decimales.");
      if (Number.isNaN(compareAtCents)) issue(errors, sourceRow, "compare_at_price", "Usa un precio anterior válido o déjalo vacío.");
      if (active === null) issue(errors, sourceRow, "product_active", "Usa true/false, sí/no o 1/0.");
      if (featured === null) issue(errors, sourceRow, "featured", "Usa true/false, sí/no o 1/0.");
      if (imageUrls === null) issue(errors, sourceRow, "image_urls", "Usa hasta 10 URLs válidas separadas por |.");
      if (categorySlug && !categoriesBySlug.has(categorySlug)) {
        issue(errors, sourceRow, "category_slug", `No existe la categoría ${categorySlug}.`);
      }

      let existingProduct = requestedId ? productsById.get(requestedId) : productsBySlug.get(slug);
      if (requestedId && !existingProduct) {
        issue(errors, sourceRow, "product_id", `No existe el producto con ID ${requestedId}; déjalo vacío para crear uno nuevo.`);
      }
      if (existingProduct && productsBySlug.get(slug) && productsBySlug.get(slug)?.id !== existingProduct.id) {
        issue(errors, sourceRow, "slug", `El slug ${slug} pertenece a otro producto.`);
      }
      const previousSlugOwner = usedSlugs.get(slug);
      const productId = existingProduct?.id ?? crypto.randomUUID();
      if (previousSlugOwner && previousSlugOwner !== productId) {
        issue(errors, sourceRow, "slug", `El slug ${slug} está repetido en el archivo.`);
      }
      usedSlugs.set(slug, productId);

      products.push({
        sourceRow,
        id: productId,
        exists: Boolean(existingProduct),
        name,
        slug,
        description,
        categoryId: categorySlug ? categoriesBySlug.get(categorySlug) ?? null : null,
        itemType: itemTypeValue === "service" ? "service" : "physical",
        priceCents: Number.isFinite(priceCents) ? Number(priceCents) : 0,
        compareAtCents: typeof compareAtCents === "number" && Number.isFinite(compareAtCents) ? compareAtCents : null,
        active: active ?? true,
        featured: featured ?? false,
        imageUrls: imageUrls ?? [],
        currentImages: currentImages.filter((image) => image.product_id === productId),
      });

      for (const row of groupRows) {
        const requestedVariantId = row.values.variant_id?.trim() ?? "";
        const sku = row.values.sku?.trim() ?? "";
        const label = row.values.variant_label?.trim() ?? "";
        const stock = parseStock(row.values.stock ?? "");
        const attributes = parseAttributes(row.values.attributes ?? "");
        const variantPriceCents = parseCents(row.values.variant_price ?? "", false);
        const trackInventory = parseBoolean(row.values.track_inventory ?? "", itemTypeValue !== "service");
        const variantActive = parseBoolean(row.values.variant_active ?? "", true);
        if (!sku) issue(errors, row.rowNumber, "sku", "El SKU es obligatorio.");
        if (seenSkus.has(sku)) issue(errors, row.rowNumber, "sku", `El SKU ${sku} está repetido en el archivo.`);
        seenSkus.add(sku);
        if (!label) issue(errors, row.rowNumber, "variant_label", "La etiqueta de la variante es obligatoria.");
        if (!Number.isFinite(stock)) issue(errors, row.rowNumber, "stock", "El stock debe ser un entero mayor o igual a cero.");
        if (attributes === null) issue(errors, row.rowNumber, "attributes", "Usa pares nombre=valor separados por punto y coma.");
        if (Number.isNaN(variantPriceCents)) issue(errors, row.rowNumber, "variant_price", "Usa un precio válido o déjalo vacío.");
        if (trackInventory === null) issue(errors, row.rowNumber, "track_inventory", "Usa true/false, sí/no o 1/0.");
        if (variantActive === null) issue(errors, row.rowNumber, "variant_active", "Usa true/false, sí/no o 1/0.");

        let existingVariant = requestedVariantId ? variantsById.get(requestedVariantId) : variantsBySku.get(sku);
        if (requestedVariantId && !existingVariant) {
          issue(errors, row.rowNumber, "variant_id", `No existe la variante con ID ${requestedVariantId}; déjalo vacío para crearla.`);
        }
        if (existingVariant && existingVariant.product_id !== productId) {
          issue(errors, row.rowNumber, "sku", `El SKU ${sku} pertenece a otro producto.`);
        }
        const skuOwner = variantsBySku.get(sku);
        if (skuOwner && skuOwner.id !== existingVariant?.id) {
          issue(errors, row.rowNumber, "sku", `El SKU ${sku} ya pertenece a otra variante.`);
        }
        variants.push({
          sourceRow: row.rowNumber,
          id: existingVariant?.id ?? crypto.randomUUID(),
          productId,
          exists: Boolean(existingVariant),
          label,
          sku,
          attributes: attributes ?? {},
          priceCents: typeof variantPriceCents === "number" && Number.isFinite(variantPriceCents) ? variantPriceCents : null,
          stock: Number.isFinite(stock) ? stock : 0,
          trackInventory: trackInventory ?? itemTypeValue !== "service",
          active: variantActive ?? true,
        });
      }
    }
  }

  if (parsed.mode === "catalog" && !parsed.headers.includes("schema_version")) {
    warnings.push("El archivo no incluye schema_version; se interpretó con la versión actual.");
  }
  const versionRows = parsed.rows.filter((row) => row.values.schema_version && row.values.schema_version !== CATALOG_SCHEMA_VERSION);
  for (const row of versionRows) {
    issue(errors, row.rowNumber, "schema_version", `La versión ${row.values.schema_version} no es compatible.`);
  }

  errors.sort((left, right) => left.row - right.row || left.field.localeCompare(right.field));
  const preview: CatalogImportPreview = {
    mode: parsed.mode,
    totalRows: parsed.rows.length,
    createdProducts: products.filter((product) => !product.exists).length,
    updatedProducts: products.filter((product) => product.exists).length,
    createdVariants: variants.filter((variant) => !variant.exists).length,
    updatedVariants: variants.filter((variant) => variant.exists).length,
    errors,
    warnings,
  };
  return { preview, products, variants };
}

export async function commitCatalogImport(
  db: D1Database,
  prepared: PreparedCatalogImport,
  source: string,
  imageBucket?: R2Bucket,
) {
  if (prepared.preview.errors.length) throw new Error("La importación contiene errores de validación.");
  const statements: D1PreparedStatement[] = [];
  const removedObjectKeys: string[] = [];

  if (prepared.preview.mode === "inventory") {
    for (const variant of prepared.variants) {
      statements.push(db.prepare(
        "UPDATE product_variants SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(variant.stock, variant.id));
    }
  } else {
    for (const product of prepared.products) {
      statements.push(db.prepare(
        `INSERT INTO products (id, name, slug, description, category_id, item_type, price_cents, compare_at_cents, active, featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, slug = excluded.slug, description = excluded.description,
           category_id = excluded.category_id, item_type = excluded.item_type,
           price_cents = excluded.price_cents, compare_at_cents = excluded.compare_at_cents,
           active = excluded.active, featured = excluded.featured, updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        product.id, product.name, product.slug, product.description, product.categoryId, product.itemType,
        product.priceCents, product.compareAtCents, product.active ? 1 : 0, product.featured ? 1 : 0,
      ));
      if (product.imageUrls.length) {
        removedObjectKeys.push(...product.currentImages
          .filter((image) => !product.imageUrls.includes(image.url) && image.object_key)
          .map((image) => image.object_key!));
        statements.push(db.prepare(
          `DELETE FROM product_images
           WHERE product_id = ? AND url NOT IN (${product.imageUrls.map(() => "?").join(",")})`,
        ).bind(product.id, ...product.imageUrls));
        for (const [position, url] of product.imageUrls.entries()) {
          const current = product.currentImages.find((image) => image.url === url);
          statements.push(db.prepare(
            `INSERT INTO product_images (id, product_id, object_key, url, alt, position)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET url = excluded.url, alt = excluded.alt, position = excluded.position`,
          ).bind(current?.id ?? crypto.randomUUID(), product.id, current?.object_key ?? null, url, product.name, position));
        }
      }
    }
    for (const variant of prepared.variants) {
      statements.push(db.prepare(
        `INSERT INTO product_variants
          (id, product_id, label, sku, attributes_json, price_cents, stock, track_inventory, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           product_id = excluded.product_id, label = excluded.label, sku = excluded.sku,
           attributes_json = excluded.attributes_json, price_cents = excluded.price_cents,
           stock = excluded.stock, track_inventory = excluded.track_inventory,
           active = excluded.active, updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        variant.id, variant.productId, variant.label, variant.sku, JSON.stringify(variant.attributes),
        variant.priceCents, variant.stock, variant.trackInventory ? 1 : 0, variant.active ? 1 : 0,
      ));
    }
  }

  statements.push(db.prepare(
    `INSERT INTO catalog_operations
      (id, operation, source, status, row_count, created_products, updated_products, created_variants, updated_variants, error_count, message)
     VALUES (?, 'import', ?, 'success', ?, ?, ?, ?, ?, 0, ?)`,
  ).bind(
    crypto.randomUUID(), source.slice(0, 180), prepared.preview.totalRows,
    prepared.preview.createdProducts, prepared.preview.updatedProducts,
    prepared.preview.createdVariants, prepared.preview.updatedVariants,
    prepared.preview.mode === "inventory" ? "Inventario actualizado." : "Catálogo importado.",
  ));
  await db.batch(statements);
  if (imageBucket && removedObjectKeys.length) {
    await Promise.allSettled(removedObjectKeys.map((key) => imageBucket.delete(key)));
  }
}

export async function recordCatalogOperationError(
  db: D1Database,
  operation: "import" | "google_sync",
  source: string,
  message: string,
  details?: Record<string, unknown>,
) {
  await db.prepare(
    `INSERT INTO catalog_operations
      (id, operation, source, status, error_count, message, details_json)
     VALUES (?, ?, ?, 'error', 1, ?, ?)`,
  ).bind(
    crypto.randomUUID(), operation, source.slice(0, 180), message.slice(0, 500),
    details ? JSON.stringify(details).slice(0, 5000) : null,
  ).run();
}

export async function getLastCatalogOperation(db: D1Database, operation: "import" | "google_sync") {
  return db.prepare(
    `SELECT status, source, row_count, message, created_at
     FROM catalog_operations WHERE operation = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(operation).first<{
    status: "success" | "error";
    source: string;
    row_count: number;
    message: string | null;
    created_at: string;
  }>();
}
