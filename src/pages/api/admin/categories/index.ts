import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { getCloudflareEnv, getErrorMessage } from "@/lib/db";
import { slugify } from "@/lib/format";

function parseSortOrder(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Origen no permitido", { status: 403 });

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const slug = slugify(String(form.get("slug") || name)).slice(0, 100);
  if (!name || !slug) return redirect("/admin/categorias?error=invalid", 303);

  try {
    const { DB } = getCloudflareEnv(locals);
    await DB.prepare(
      "INSERT INTO categories (id, name, slug, sort_order, active) VALUES (?, ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      name,
      slug,
      parseSortOrder(form.get("sortOrder")),
      form.has("active") ? 1 : 0,
    ).run();
    return redirect("/admin/categorias?success=created", 303);
  } catch (error) {
    const reason = getErrorMessage(error).includes("UNIQUE") ? "duplicate" : "save";
    return redirect(`/admin/categorias?error=${reason}`, 303);
  }
};
