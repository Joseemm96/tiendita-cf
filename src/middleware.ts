import { defineMiddleware } from "astro:middleware";
import { ADMIN_COOKIE, getSafeAdminPath, verifyAdminSession } from "@/lib/auth";
import { getCloudflareEnv } from "@/lib/db";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const isLoginPage = path === "/admin/login";
  const isAdminPage = path.startsWith("/admin") && path !== "/admin/login";
  const isAdminApi = path.startsWith("/api/admin") && path !== "/api/admin/login";

  if (!isLoginPage && !isAdminPage && !isAdminApi) return next();

  const secret = getCloudflareEnv(context.locals).SESSION_SECRET;
  const session = context.cookies.get(ADMIN_COOKIE)?.value;
  const authenticated = await verifyAdminSession(session, secret);

  if (isLoginPage) {
    return authenticated
      ? context.redirect(getSafeAdminPath(context.url.searchParams.get("next")))
      : next();
  }

  if (authenticated) return next();

  if (isAdminApi) {
    return new Response(JSON.stringify({ error: "Sesión no válida." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return context.redirect(`/admin/login?next=${encodeURIComponent(path)}`);
});
