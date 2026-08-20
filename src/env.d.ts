/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

declare namespace Cloudflare {
  interface Env {
    ADMIN_PASSWORD: string;
    SESSION_SECRET: string;
    GOOGLE_SERVICE_ACCOUNT_JSON: string;
    GOOGLE_SHEET_ID: string;
  }
}

interface CloudflareEnv {
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  DB: D1Database;
  PRODUCT_IMAGES: R2Bucket;
  ASSETS: Fetcher;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_SHEET_ID: string;
}

declare namespace App {
  interface Locals {
    cfContext: ExecutionContext;
  }
}
