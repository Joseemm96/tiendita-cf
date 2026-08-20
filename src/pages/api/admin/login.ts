import type { APIRoute } from "astro";
import { ADMIN_COOKIE, ADMIN_SESSION_DURATION, createAdminSession, getSafeAdminPath, isSameOrigin, secureCompare } from "@/lib/auth";
import { getCloudflareEnv } from "@/lib/db";

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Origen no permitido", { status: 403 });
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const env = getCloudflareEnv(locals);

  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return new Response("Configura ADMIN_PASSWORD y SESSION_SECRET en los secretos del Worker.", { status: 503 });
  }

  if (!(await secureCompare(password, env.ADMIN_PASSWORD))) {
    return redirect("/admin/login?error=1", 303);
  }

  cookies.set(ADMIN_COOKIE, await createAdminSession(env.SESSION_SECRET), {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_DURATION,
  });
  return redirect(getSafeAdminPath(String(form.get("next") ?? "/admin")), 303);
};
