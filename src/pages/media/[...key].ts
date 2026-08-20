import type { APIRoute } from "astro";
import { getCloudflareEnv } from "@/lib/db";

export const GET: APIRoute = async ({ params, request, locals }) => {
  const key = params.key;
  if (!key) return new Response("Not found", { status: 404 });

  const { PRODUCT_IMAGES } = getCloudflareEnv(locals);
  const object = await PRODUCT_IMAGES.get(key, {
    onlyIf: request.headers,
  });
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
};
