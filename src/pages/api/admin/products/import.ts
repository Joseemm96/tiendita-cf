import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { parseCatalogUpload } from "@/lib/catalog-files";
import {
  commitCatalogImport,
  prepareCatalogImport,
  recordCatalogOperationError,
} from "@/lib/catalog-service";
import { getCloudflareEnv } from "@/lib/db";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!isSameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const commit = url.searchParams.get("commit") === "1";
  const { DB, PRODUCT_IMAGES } = getCloudflareEnv(locals);
  let source = "archivo";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Selecciona un archivo CSV o XLSX." }, 400);
    source = file.name || source;
    const parsed = await parseCatalogUpload(file);
    const prepared = await prepareCatalogImport(DB, parsed);
    if (commit && prepared.preview.errors.length) {
      return json({ error: "Corrige los errores antes de importar.", preview: prepared.preview }, 422);
    }
    if (commit) {
      await commitCatalogImport(DB, prepared, source, PRODUCT_IMAGES);
      return json({ ok: true, preview: prepared.preview, message: "La importación se completó correctamente." });
    }
    return json({ ok: true, preview: prepared.preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible procesar el archivo.";
    if (commit) await recordCatalogOperationError(DB, "import", source, message).catch(() => undefined);
    return json({ error: message }, 400);
  }
};
