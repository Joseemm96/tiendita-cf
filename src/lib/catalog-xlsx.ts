import readExcelFile from "read-excel-file/universal";
import writeExcelFile, { type Cell, type Row, type SheetData } from "write-excel-file/universal";
import {
  CATALOG_HEADERS,
  INVENTORY_HEADERS,
  matrixToCatalogFile,
  type CatalogImportMode,
  type ParsedCatalogFile,
} from "./catalog-schema";

const HEADER_BACKGROUND = "#181815";
const HEADER_TEXT = "#FFFDF8";
const ACCENT = "#D95D39";
const MUTED_BACKGROUND = "#F5F1E9";

const WIDTHS: Record<string, number> = {
  schema_version: 14,
  product_id: 38,
  slug: 25,
  product_name: 30,
  description: 55,
  category_slug: 22,
  item_type: 16,
  product_price: 17,
  compare_at_price: 19,
  product_active: 17,
  featured: 13,
  variant_id: 38,
  sku: 21,
  variant_label: 26,
  attributes: 32,
  variant_price: 17,
  stock: 12,
  track_inventory: 19,
  variant_active: 17,
  image_urls: 55,
};

function headerCell(value: string): Cell {
  return {
    value,
    type: String,
    fontWeight: "bold",
    textColor: HEADER_TEXT,
    backgroundColor: HEADER_BACKGROUND,
    alignVertical: "center",
    height: 28,
    wrap: true,
    bottomBorderColor: ACCENT,
    bottomBorderStyle: "medium",
  };
}

function dataCell(header: string, value: string): Cell {
  if (["product_price", "compare_at_price", "variant_price"].includes(header)) {
    return value === "" ? null : { value: Number(value), type: Number, format: "#,##0.00", align: "right" };
  }
  if (header === "stock") {
    return value === "" ? null : { value: Number(value), type: Number, format: "#,##0", align: "right" };
  }
  if (["product_active", "featured", "track_inventory", "variant_active"].includes(header)) {
    return value === "" ? null : { value: value === "true" || value === "1", type: Boolean, align: "center" };
  }
  return { value, type: String, alignVertical: "top", wrap: ["description", "attributes", "image_urls"].includes(header) };
}

function catalogSheetData(headers: readonly string[], rows: Record<string, string>[]): SheetData {
  return [
    headers.map(headerCell),
    ...rows.map<Row>((row) => headers.map((header) => dataCell(header, row[header] ?? ""))),
  ];
}

function instructionsData(mode: CatalogImportMode): SheetData {
  const title = mode === "inventory" ? "Plantilla de actualización de inventario" : "Importación y exportación de catálogo";
  const instructions = mode === "inventory"
    ? [
      ["sku", "SKU único de la variante. No puede estar vacío."],
      ["stock", "Existencia final que quedará guardada. Debe ser un entero mayor o igual a cero."],
    ]
    : [
      ["schema_version", "Versión de la plantilla. Utiliza 1."],
      ["product_id / variant_id", "Déjalos vacíos para crear. Las exportaciones los incluyen para actualizar con precisión."],
      ["slug", "Identificador legible del producto. Si está vacío se genera desde el nombre."],
      ["category_slug", "Slug de una categoría existente. Déjalo vacío para usar Sin categoría."],
      ["item_type", "physical o service."],
      ["product_price / variant_price", "Importes decimales sin símbolo de moneda. El precio de variante es opcional."],
      ["attributes", "Pares nombre=valor separados por punto y coma. Ejemplo: talla=M;color=Negro."],
      ["image_urls", "URLs separadas por |. Si queda vacío, las imágenes existentes no cambian."],
      ["campos booleanos", "Aceptan true/false, 1/0, sí/no."],
      ["filas omitidas", "Omitir una variante no la elimina. Usa variant_active=false para ocultarla."],
    ];
  return [
    [{ value: title, type: String, fontWeight: "bold", fontSize: 18, textColor: HEADER_BACKGROUND, columnSpan: 2, height: 34 }],
    [{ value: "Cómo usarla", type: String, fontWeight: "bold", textColor: ACCENT, columnSpan: 2 }],
    [{ value: "1. Completa la hoja de datos sin cambiar los encabezados. 2. Guarda como XLSX. 3. Sube el archivo y revisa la vista previa antes de confirmar.", type: String, wrap: true, columnSpan: 2, height: 44 }],
    [headerCell("Campo"), headerCell("Regla")],
    ...instructions.map<Row>((row) => [
      { value: row[0], type: String, fontWeight: "bold", backgroundColor: MUTED_BACKGROUND, alignVertical: "top" },
      { value: row[1], type: String, wrap: true, alignVertical: "top" },
    ]),
  ];
}

export async function createCatalogXlsx(
  mode: CatalogImportMode,
  rows: Record<string, string>[],
) {
  const headers = mode === "inventory" ? INVENTORY_HEADERS : CATALOG_HEADERS;
  const workbook = writeExcelFile([
    {
      data: catalogSheetData(headers, rows),
      sheet: mode === "inventory" ? "Inventario" : "Productos",
      columns: headers.map((header) => ({ width: WIDTHS[header] ?? 18 })),
      stickyRowsCount: 1,
      showGridLines: false,
      zoomScale: 85,
    },
    {
      data: instructionsData(mode),
      sheet: "Instrucciones",
      columns: [{ width: 29 }, { width: 85 }],
      stickyRowsCount: 4,
      showGridLines: false,
      zoomScale: 95,
    },
  ], { fontFamily: "Arial", fontSize: 10 });
  return workbook.toBlob();
}

export async function parseCatalogXlsx(file: Blob): Promise<ParsedCatalogFile> {
  const sheets = await readExcelFile(file);
  const preferred = sheets.find((sheet) => ["productos", "inventario"].includes(sheet.sheet.toLowerCase()))
    ?? sheets[0];
  if (!preferred) throw new Error("El archivo Excel no contiene hojas.");
  return matrixToCatalogFile(preferred.data as unknown[][]);
}
