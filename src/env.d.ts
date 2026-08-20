/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

declare namespace Cloudflare {
  interface Env {
    ADMIN_PASSWORD: string;
    SESSION_SECRET: string;
  }
}

interface CloudflareEnv {
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

declare namespace App {
  interface Locals {
    cfContext: ExecutionContext;
  }
}
