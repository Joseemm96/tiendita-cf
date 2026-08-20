import { recordCatalogOperationError } from "./catalog-service";

const SHEET_NAME = "Inventario";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type InventorySyncRow = {
  sku: string;
  product_name: string;
  variant_label: string;
  stock: number;
  track_inventory: number;
  product_active: number;
  variant_active: number;
  item_type: "physical" | "service";
  updated_at: string;
};

function base64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem: string) {
  const base64 = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getGoogleConfiguration(env: CloudflareEnv) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_SHEET_ID) return null;
  try {
    const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as GoogleServiceAccount;
    if (!credentials.client_email || !credentials.private_key) return null;
    return { credentials, spreadsheetId: env.GOOGLE_SHEET_ID.trim() };
  } catch {
    return null;
  }
}

export function isGoogleSheetsConfigured(env: CloudflareEnv) {
  return Boolean(getGoogleConfiguration(env));
}

export function getGoogleSheetUrl(env: CloudflareEnv) {
  const configuration = getGoogleConfiguration(env);
  return configuration ? `https://docs.google.com/spreadsheets/d/${configuration.spreadsheetId}/edit` : null;
}

async function getAccessToken(credentials: GoogleServiceAccount) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: SHEETS_SCOPE,
    aud: credentials.token_uri || "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const result = await response.json() as { access_token?: string; error_description?: string; error?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || "Google no aceptó las credenciales configuradas.");
  }
  return result.access_token;
}

async function googleRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(result?.error?.message || `Google Sheets respondió con el estado ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function ensureInventorySheet(spreadsheetId: string, token: string) {
  const metadata = await googleRequest<{ sheets?: { properties?: { title?: string; sheetId?: number } }[] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`,
    token,
  );
  const existing = metadata.sheets?.find((sheet) => sheet.properties?.title === SHEET_NAME)?.properties;
  if (existing?.sheetId !== undefined) return existing.sheetId;
  const created = await googleRequest<{ replies?: { addSheet?: { properties?: { sheetId?: number } } }[] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          { addSheet: { properties: { title: SHEET_NAME, gridProperties: { frozenRowCount: 1 } } } },
        ],
      }),
    },
  );
  const sheetId = created.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId === undefined) throw new Error("Google creó la pestaña, pero no devolvió su identificador.");
  return sheetId;
}

async function formatInventorySheet(spreadsheetId: string, sheetId: number, token: string) {
  await googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.094, green: 0.094, blue: 0.082 },
                  textFormat: { foregroundColor: { red: 1, green: 0.992, blue: 0.973 }, bold: true },
                  horizontalAlignment: "CENTER",
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            },
          },
          { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 } } } },
          { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 7 } } },
        ],
      }),
    },
  );
}

function inventoryStatus(row: InventorySyncRow) {
  if (!row.product_active || !row.variant_active) return "Inactivo";
  if (row.item_type === "service" || !row.track_inventory) return "Sin control";
  if (row.stock === 0) return "Agotado";
  if (row.stock <= 5) return "Bajo";
  return "Disponible";
}

async function getInventoryRows(db: D1Database) {
  const result = await db.prepare(
    `SELECT pv.sku, p.name AS product_name, pv.label AS variant_label, pv.stock,
            pv.track_inventory, p.active AS product_active, pv.active AS variant_active,
            p.item_type,
            CASE WHEN pv.updated_at > p.updated_at THEN pv.updated_at ELSE p.updated_at END AS updated_at
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     ORDER BY p.name COLLATE NOCASE, pv.label COLLATE NOCASE`,
  ).all<InventorySyncRow>();
  return result.results;
}

export async function syncInventoryToGoogleSheets(
  db: D1Database,
  env: CloudflareEnv,
  source: "manual" | "cron",
) {
  const configuration = getGoogleConfiguration(env);
  if (!configuration) throw new Error("Google Sheets todavía no está configurado.");
  try {
    const [token, rows] = await Promise.all([
      getAccessToken(configuration.credentials),
      getInventoryRows(db),
    ]);
    const sheetId = await ensureInventorySheet(configuration.spreadsheetId, token);
    const range = encodeURIComponent(`${SHEET_NAME}!A:G`);
    const current = await googleRequest<{ values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(configuration.spreadsheetId)}/values/${range}`,
      token,
    );
    const syncedAt = new Date().toISOString();
    const values: (string | number | boolean)[][] = [
      ["SKU", "Producto", "Variante", "Stock", "Controlado", "Estado", "Actualizado"],
      ...rows.map((row) => [
        row.sku,
        row.product_name,
        row.variant_label,
        row.stock,
        Boolean(row.track_inventory),
        inventoryStatus(row),
        row.updated_at,
      ]),
    ];
    const previousLength = current.values?.length ?? 0;
    while (values.length < previousLength) values.push(["", "", "", "", "", "", ""]);
    await googleRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(configuration.spreadsheetId)}/values/${range}?valueInputOption=RAW`,
      token,
      { method: "PUT", body: JSON.stringify({ range: `${SHEET_NAME}!A:G`, majorDimension: "ROWS", values }) },
    );
    await formatInventorySheet(configuration.spreadsheetId, sheetId, token);
    await db.prepare(
      `INSERT INTO catalog_operations
        (id, operation, source, status, row_count, message, details_json)
       VALUES (?, 'google_sync', ?, 'success', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), source, rows.length, "Inventario sincronizado con Google Sheets.",
      JSON.stringify({ syncedAt, spreadsheetId: configuration.spreadsheetId }),
    ).run();
    return { rowCount: rows.length, syncedAt, sheetUrl: getGoogleSheetUrl(env) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible sincronizar con Google Sheets.";
    await recordCatalogOperationError(db, "google_sync", source, message).catch(() => undefined);
    throw error;
  }
}
