import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { getCloudflareEnv } from "@/lib/db";

const transitions: Record<string, string[]> = {
  pending: ["pending", "confirmed", "cancelled"],
  confirmed: ["confirmed", "delivered", "cancelled"],
  delivered: ["delivered"],
  cancelled: ["cancelled"],
};

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Origen no permitido", { status: 403 });
  const form = await request.formData();
  const nextStatus = String(form.get("status") ?? "");
  const { DB } = getCloudflareEnv(locals);
  const order = await DB.prepare("SELECT status FROM orders WHERE id = ?").bind(params.id).first<{ status: string }>();
  if (!order || !transitions[order.status]?.includes(nextStatus)) {
    return redirect("/admin/ordenes?error=transition", 303);
  }
  try {
    await DB.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(nextStatus, params.id).run();
    return redirect("/admin/ordenes", 303);
  } catch {
    return redirect("/admin/ordenes?error=stock", 303);
  }
};
