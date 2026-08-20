import {
  CATALOG_HEADERS,
  INVENTORY_HEADERS,
  MAX_IMPORT_FILE_BYTES,
  catalogTemplateRows,
  inventoryTemplateRows,
  matrixToCatalogFile,
  parseCsv,
  serializeCsv,
  type CatalogImportMode,
} from "./catalog-schema";
import { createCatalogXlsx, parseCatalogXlsx } from "./catalog-xlsx";

export type CatalogFileFormat = "csv" | "xlsx";

export async function parseCatalogUpload(file: File) {
  if (!file.size) throw new Error("Selecciona un archivo CSV o XLSX.");
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error("El archivo supera el máximo de 5 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    return matrixToCatalogFile(parseCsv(await file.text()));
  }
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return parseCatalogXlsx(file);
  }
  throw new Error("Formato no compatible. Usa un archivo .csv o .xlsx.");
}

export async function createCatalogFile(
  format: CatalogFileFormat,
  mode: CatalogImportMode,
  rows: Record<string, string>[],
) {
  if (format === "csv") {
    return new Blob([
      serializeCsv(mode === "inventory" ? INVENTORY_HEADERS : CATALOG_HEADERS, rows),
    ], { type: "text/csv;charset=utf-8" });
  }
  return createCatalogXlsx(mode, rows);
}

export function getTemplateRows(mode: CatalogImportMode) {
  return mode === "inventory" ? inventoryTemplateRows() : catalogTemplateRows();
}

export function catalogContentType(format: CatalogFileFormat) {
  return format === "csv"
    ? "text/csv; charset=utf-8"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
