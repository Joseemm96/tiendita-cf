import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { getCloudflareEnv, getErrorMessage } from "@/lib/db";
import { slugify } from "@/lib/format";

function parseSortOrder(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Origen no permitido", { status: 403 });
  const id = params.id ?? "";
  if (!id) return redirect("/admin/categorias?error=invalid", 303);

  const form = await request.formData();
  const { DB } = getCloudflareEnv(locals);

  try {
    if (form.get("_action") === "delete") {
      await DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
      return redirect("/admin/categorias?success=deleted", 303);
    }

    const name = String(form.get("name") ?? "").trim().slice(0, 80);
    const slug = slugify(String(form.get("slug") || name)).slice(0, 100);
    if (!name || !slug) return redirect("/admin/categorias?error=invalid", 303);

    await DB.prepare(
      "UPDATE categories SET name = ?, slug = ?, sort_order = ?, active = ? WHERE id = ?",
    ).bind(
      name,
      slug,
      parseSortOrder(form.get("sortOrder")),
      form.has("active") ? 1 : 0,
      id,
    ).run();
    return redirect("/admin/categorias?success=updated", 303);
  } catch (error) {
    const reason = getErrorMessage(error).includes("UNIQUE") ? "duplicate" : "save";
    return redirect(`/admin/categorias?error=${reason}`, 303);
  }
};
