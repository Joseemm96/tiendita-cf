import { slugify } from "./format";

export const CATALOG_SCHEMA_VERSION = "1";
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

export const CATALOG_HEADERS = [
  "schema_version",
  "product_id",
  "slug",
  "product_name",
  "description",
  "category_slug",
  "item_type",
  "product_price",
  "compare_at_price",
  "product_active",
  "featured",
  "variant_id",
  "sku",
  "variant_label",
  "attributes",
  "variant_price",
  "stock",
  "track_inventory",
  "variant_active",
  "image_urls",
] as const;

export const INVENTORY_HEADERS = ["sku", "stock"] as const;

export type CatalogHeader = (typeof CATALOG_HEADERS)[number];
export type CatalogImportMode = "catalog" | "inventory";
export type CatalogRow = Record<CatalogHeader, string>;
export type InventoryRow = { sku: string; stock: string };

export type TabularRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export type ParsedCatalogFile = {
  headers: string[];
  mode: CatalogImportMode;
  rows: TabularRow[];
};

const HEADER_ALIASES: Record<string, string> = {
  version: "schema_version",
  id_producto: "product_id",
  producto_id: "product_id",
  nombre_producto: "product_name",
  producto: "product_name",
  descripcion: "description",
  categoria: "category_slug",
  categoria_slug: "category_slug",
  tipo: "item_type",
  precio: "product_price",
  precio_producto: "product_price",
  precio_anterior: "compare_at_price",
  producto_activo: "product_active",
  destacado: "featured",
  id_variante: "variant_id",
  variante_id: "variant_id",
  variante: "variant_label",
  etiqueta_variante: "variant_label",
  atributos: "attributes",
  precio_variante: "variant_price",
  inventario: "stock",
  existencia: "stock",
  controlar_inventario: "track_inventory",
  variante_activa: "variant_active",
  imagenes: "image_urls",
  urls_imagenes: "image_urls",
};

export function normalizeHeader(value: string) {
  const normalized = value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return HEADER_ALIASES[normalized] ?? normalized;
}

export function cellToString(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value).trim();
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

export function matrixToCatalogFile(matrix: unknown[][]): ParsedCatalogFile {
  const nonEmpty = matrix.filter((row) => row.some((cell) => cellToString(cell) !== ""));
  if (!nonEmpty.length) throw new Error("El archivo está vacío.");

  const headers = nonEmpty[0].map((cell) => normalizeHeader(cellToString(cell)));
  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicates.length) throw new Error(`Hay columnas repetidas: ${[...new Set(duplicates)].join(", ")}.`);

  const headerSet = new Set(headers);
  const mode: CatalogImportMode = headerSet.has("sku") && headerSet.has("stock") && !headerSet.has("product_name")
    ? "inventory"
    : "catalog";
  const required = mode === "inventory"
    ? INVENTORY_HEADERS
    : (["product_name", "sku", "variant_label", "stock", "product_price"] as const);
  const missing = required.filter((header) => !headerSet.has(header));
  if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(", ")}.`);

  const rows = nonEmpty.slice(1).map<TabularRow>((row, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, cellToString(row[column])])),
  })).filter((row) => Object.values(row.values).some(Boolean));

  if (!rows.length) throw new Error("El archivo no contiene filas de productos.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`El archivo supera el máximo de ${MAX_IMPORT_ROWS} filas por importación.`);
  }
  return { headers, mode, rows };
}

function detectDelimiter(text: string) {
  const firstRecord = text.split(/\r?\n/, 1)[0] ?? "";
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let index = 0; index < firstRecord.length; index += 1) {
    const character = firstRecord[index];
    if (character === '"') quoted = !quoted;
    if (!quoted && character === ",") commas += 1;
    if (!quoted && character === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(text: string) {
  const delimiter = detectDelimiter(text);
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      matrix.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("El CSV contiene una comilla sin cerrar.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    matrix.push(row);
  }
  return matrix;
}

function spreadsheetSafe(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: unknown) {
  const text = spreadsheetSafe(cellToString(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeCsv(headers: readonly string[], rows: Record<string, string>[]) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function emptyCatalogRow(): CatalogRow {
  return Object.fromEntries(CATALOG_HEADERS.map((header) => [header, ""])) as CatalogRow;
}

export function catalogTemplateRows(): CatalogRow[] {
  const base = {
    ...emptyCatalogRow(),
    schema_version: CATALOG_SCHEMA_VERSION,
    slug: "producto-ejemplo",
    product_name: "Producto de ejemplo",
    description: "Reemplaza esta descripción antes de importar.",
    category_slug: "",
    item_type: "physical",
    product_price: "48.00",
    compare_at_price: "58.00",
    product_active: "true",
    featured: "true",
    track_inventory: "true",
    variant_active: "true",
    image_urls: "https://ejemplo.com/producto-frente.webp|https://ejemplo.com/producto-detalle.webp",
  } satisfies CatalogRow;
  return [
    { ...base, sku: "EJEMPLO-S", variant_label: "S · Arena", attributes: "talla=S;color=Arena", stock: "6" },
    { ...base, sku: "EJEMPLO-M", variant_label: "M · Arena", attributes: "talla=M;color=Arena", stock: "9" },
  ];
}

export function inventoryTemplateRows(): InventoryRow[] {
  return [
    { sku: "LIN-ARE-S", stock: "8" },
    { sku: "LIN-ARE-M", stock: "12" },
  ];
}

export function fallbackSlug(name: string) {
  return slugify(name) || `producto-${crypto.randomUUID().slice(0, 8)}`;
}
