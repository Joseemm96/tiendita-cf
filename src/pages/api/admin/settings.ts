import type { APIRoute } from "astro";
import { isSameOrigin } from "@/lib/auth";
import { getCloudflareEnv } from "@/lib/db";

const fields: Record<string, string> = {
  brandName: "brand_name", tagline: "tagline", description: "description",
  heroTitle: "hero_title", heroSubtitle: "hero_subtitle",
  whatsappNumber: "whatsapp_number", currency: "currency", locale: "locale",
  accentColor: "accent_color", supportEmail: "support_email", announcement: "announcement",
  instagramUrl: "instagram_url", facebookUrl: "facebook_url",
};

const activeFields: Record<string, string> = {
  whatsappActive: "whatsapp_active",
  instagramActive: "instagram_active",
  facebookActive: "facebook_active",
};

function validateUrl(value: string, label: string) {
  if (!value) return value;
  const parsed = new URL(value);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error(`El enlace de ${label} no es válido.`);
  }
  return parsed.toString();
}

async function saveHeroImage(bucket: R2Bucket, form: FormData) {
  const file = form.get("heroImage");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) throw new Error("La imagen del hero supera el máximo de 5 MB.");
    if (!new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]).has(file.type)) {
      throw new Error("Usa una imagen JPEG, PNG, WebP o AVIF para el hero.");
    }
    const extension = file.type.split("/")[1].replace("jpeg", "jpg");
    const key = `settings/hero/${crypto.randomUUID()}.${extension}`;
    await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    return `/media/${key}`;
  }

  const value = String(form.get("heroImageUrl") ?? "").trim().slice(0, 1000);
  if (!value) throw new Error("Agrega una imagen para el hero.");
  if (value.startsWith("/")) return value;
  return validateUrl(value, "imagen");
}

async function saveLogoImage(bucket: R2Bucket, form: FormData) {
  const file = form.get("logoImage");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) throw new Error("El logo supera el máximo de 5 MB.");
    if (!new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]).has(file.type)) {
      throw new Error("Usa un logo JPEG, PNG, WebP o AVIF.");
    }
    const extension = file.type.split("/")[1].replace("jpeg", "jpg");
    const key = `settings/logo/${crypto.randomUUID()}.${extension}`;
    await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    return `/media/${key}`;
  }

  if (form.has("removeLogo")) return "";
  const value = String(form.get("logoUrl") ?? "").trim().slice(0, 1000);
  if (!value || value.startsWith("/")) return value;
  return validateUrl(value, "logo");
}

async function saveLoginImage(bucket: R2Bucket, form: FormData) {
  const file = form.get("loginImage");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) throw new Error("La imagen del login supera el máximo de 5 MB.");
    if (!new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]).has(file.type)) {
      throw new Error("Usa una imagen JPEG, PNG, WebP o AVIF para el login.");
    }
    const extension = file.type.split("/")[1].replace("jpeg", "jpg");
    const key = `settings/login/${crypto.randomUUID()}.${extension}`;
    await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    return `/media/${key}`;
  }

  if (form.has("removeLoginImage")) return "";
  const value = String(form.get("loginImageUrl") ?? "").trim().slice(0, 1000);
  if (!value || value.startsWith("/")) return value;
  return validateUrl(value, "imagen del login");
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Origen no permitido", { status: 403 });
  const form = await request.formData();
  try {
    const { DB, PRODUCT_IMAGES } = getCloudflareEnv(locals);
    const [heroImageUrl, logoUrl, loginImageUrl, currentLogo, currentLoginImage] = await Promise.all([
      saveHeroImage(PRODUCT_IMAGES, form),
      saveLogoImage(PRODUCT_IMAGES, form),
      saveLoginImage(PRODUCT_IMAGES, form),
      DB.prepare("SELECT value FROM settings WHERE key = 'logo_url'").first<{ value: string }>(),
      DB.prepare("SELECT value FROM settings WHERE key = 'login_image_url'").first<{ value: string }>(),
    ]);
    const statements = Object.entries(fields).map(([formKey, dbKey]) => {
      const longField = formKey === "description" || formKey === "heroSubtitle";
      let value = String(form.get(formKey) ?? "").trim().slice(0, longField ? 800 : 1000);
      if (formKey === "whatsappNumber") value = value.replace(/\D/g, "");
      if (formKey === "currency") value = value.toUpperCase().slice(0, 3);
      if (formKey === "instagramUrl") value = validateUrl(value, "Instagram");
      if (formKey === "facebookUrl") value = validateUrl(value, "Facebook");
      return DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(dbKey, value);
    });
    statements.push(DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('hero_image_url', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(heroImageUrl));
    statements.push(DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('logo_url', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(logoUrl));
    statements.push(DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('login_image_url', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(loginImageUrl));
    Object.entries(activeFields).forEach(([formKey, dbKey]) => {
      statements.push(DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(dbKey, form.has(formKey) ? "1" : "0"));
    });
    await DB.batch(statements);
    const oldLogoUrl = currentLogo?.value ?? "";
    if (oldLogoUrl !== logoUrl && oldLogoUrl.startsWith("/media/settings/logo/")) {
      await PRODUCT_IMAGES.delete(oldLogoUrl.slice("/media/".length)).catch(() => undefined);
    }
    const oldLoginImageUrl = currentLoginImage?.value ?? "";
    if (oldLoginImageUrl !== loginImageUrl && oldLoginImageUrl.startsWith("/media/settings/login/")) {
      await PRODUCT_IMAGES.delete(oldLoginImageUrl.slice("/media/".length)).catch(() => undefined);
    }
    return redirect("/admin/ajustes", 303);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "No fue posible guardar los ajustes.", { status: 400 });
  }
};
