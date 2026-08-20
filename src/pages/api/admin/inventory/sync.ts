import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { getCloudflareEnv } from "@/lib/db";
import { syncInventoryToGoogleSheets } from "@/lib/google-sheets";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isSameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  try {
    const cloudflare = getCloudflareEnv(locals);
    const result = await syncInventoryToGoogleSheets(cloudflare.DB, cloudflare, "manual");
    return json({ ok: true, ...result, message: `Se sincronizaron ${result.rowCount} variantes.` });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "No fue posible sincronizar el inventario.",
    }, 400);
  }
};
