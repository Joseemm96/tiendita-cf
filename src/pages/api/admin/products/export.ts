import type { APIRoute } from "astro";
import { createCatalogFile, catalogContentType, getTemplateRows, type CatalogFileFormat } from "@/lib/catalog-files";
import { exportCatalogRows } from "@/lib/catalog-service";
import type { CatalogImportMode } from "@/lib/catalog-schema";
import { getCloudflareEnv } from "@/lib/db";

export const GET: APIRoute = async ({ url, locals }) => {
  const format: CatalogFileFormat = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const mode: CatalogImportMode = url.searchParams.get("mode") === "inventory" ? "inventory" : "catalog";
  const isTemplate = url.searchParams.get("template") === "1";
  const catalogRows = isTemplate ? getTemplateRows(mode) : await exportCatalogRows(getCloudflareEnv(locals).DB);
  const rows = mode === "inventory"
    ? catalogRows.map((row) => ({ sku: row.sku, stock: row.stock }))
    : catalogRows;
  const file = await createCatalogFile(format, mode, rows);
  const basename = isTemplate
    ? `plantilla-${mode === "inventory" ? "inventario" : "productos"}`
    : `${mode === "inventory" ? "inventario" : "productos"}-${new Date().toISOString().slice(0, 10)}`;
  return new Response(file, {
    headers: {
      "Content-Type": catalogContentType(format),
      "Content-Disposition": `attachment; filename="${basename}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
