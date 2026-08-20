import type { APIRoute } from "astro";
import { ADMIN_COOKIE, isSameOrigin } from "@/lib/auth";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Origen no permitido", { status: 403 });
  cookies.delete(ADMIN_COOKIE, { path: "/" });
  return redirect("/admin/login", 303);
};
