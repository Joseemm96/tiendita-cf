import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { StoreSettings } from "@/config/store";

export type ReceiptOrder = {
  number: string;
  status: string;
  customer_name: string;
  phone: string;
  customer_email: string | null;
  delivery_method: string;
  address: string | null;
  notes: string | null;
  subtotal_cents: number;
  total_cents: number;
  currency: string;
  created_at: string;
};

export type ReceiptItem = {
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  price_cents: number;
  quantity: number;
  subtotal_cents: number;
};

export type ReceiptLogo = {
  bytes: Uint8Array;
  contentType: string;
};

type ReceiptInput = {
  order: ReceiptOrder;
  items: ReceiptItem[];
  settings: StoreSettings;
  logo?: ReceiptLogo | null;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;

function pdfText(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u20AC]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function colorFromHex(value: string) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
  if (!match) return rgb(0.85, 0.36, 0.22);
  return rgb(
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  );
}

function wrapText(text: string, font: PDFFont, size: number, maximumWidth: number) {
  const normalized = pdfText(text);
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maximumWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maximumWidth) {
      line = word;
      continue;
    }

    let fragment = "";
    for (const character of word) {
      const next = `${fragment}${character}`;
      if (fragment && font.widthOfTextAtSize(next, size) > maximumWidth) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines;
}

function drawRight(page: PDFPage, text: string, right: number, y: number, font: PDFFont, size: number, color = rgb(0.12, 0.12, 0.11)) {
  const safeText = pdfText(text);
  page.drawText(safeText, {
    x: right - font.widthOfTextAtSize(safeText, size),
    y,
    font,
    size,
    color,
  });
}

function formatMoney(cents: number, currency: string, locale: string) {
  return pdfText(new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100));
}

function formatDate(value: string, locale: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return pdfText(new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Caracas",
  }).format(date));
}

function statusLabel(status: string) {
  return ({
    pending: "Pendiente",
    confirmed: "Confirmada",
    delivered: "Entregada",
    cancelled: "Cancelada",
  } as Record<string, string>)[status] ?? status;
}

function compactLink(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

async function embedLogo(document: PDFDocument, logo?: ReceiptLogo | null) {
  if (!logo) return null;
  try {
    if (logo.contentType === "image/png") return await document.embedPng(logo.bytes);
    if (logo.contentType === "image/jpeg" || logo.contentType === "image/jpg") {
      return await document.embedJpg(logo.bytes);
    }
  } catch {
    return null;
  }
  return null;
}

export async function createOrderReceiptPdf({ order, items, settings, logo }: ReceiptInput) {
  const document = await PDFDocument.create();
  document.setTitle(`Recibo ${order.number} - ${settings.brandName}`);
  document.setAuthor(settings.brandName);
  document.setSubject("Recibo de orden");
  document.setCreator("Tiendita Cloudflare");

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await embedLogo(document, logo);
  const accent = colorFromHex(settings.accentColor);
  const ink = rgb(0.11, 0.11, 0.1);
  const muted = rgb(0.42, 0.42, 0.39);
  const line = rgb(0.88, 0.88, 0.85);
  const paper = rgb(0.97, 0.97, 0.95);
  let pageNumber = 0;
  let page!: PDFPage;
  let y = 0;

  const drawPageNumber = (target: PDFPage) => {
    drawRight(target, `Página ${pageNumber}`, PAGE_WIDTH - MARGIN, 22, regular, 8, muted);
  };

  const drawBrand = (target: PDFPage, image: PDFImage | null) => {
    target.drawRectangle({ x: 0, y: PAGE_HEIGHT - 9, width: PAGE_WIDTH, height: 9, color: accent });
    let brandX = MARGIN;
    if (image) {
      const ratio = Math.min(76 / image.width, 48 / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      target.drawImage(image, { x: MARGIN, y: PAGE_HEIGHT - 78, width, height });
      brandX += width + 14;
    }
    const brandLines = wrapText(settings.brandName, bold, 20, 260 - (brandX - MARGIN));
    target.drawText(brandLines[0] || pdfText(settings.brandName), { x: brandX, y: PAGE_HEIGHT - 52, font: bold, size: 20, color: ink });
    target.drawText(pdfText(settings.tagline), { x: brandX, y: PAGE_HEIGHT - 69, font: regular, size: 8.5, color: muted });
  };

  const addPage = (continuation = false) => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    drawBrand(page, continuation ? null : logoImage);
    if (continuation) {
      page.drawText(`Recibo ${pdfText(order.number)} - continuación`, { x: MARGIN, y: PAGE_HEIGHT - 101, font: bold, size: 12, color: ink });
      y = PAGE_HEIGHT - 124;
    } else {
      y = PAGE_HEIGHT - 104;
    }
    return page;
  };

  const ensureSpace = (height: number) => {
    if (y - height >= 90) return;
    drawPageNumber(page);
    addPage(true);
  };

  addPage();

  page.drawText("RECIBO", { x: PAGE_WIDTH - MARGIN - 126, y: PAGE_HEIGHT - 47, font: bold, size: 10, color: accent });
  drawRight(page, order.number, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 66, bold, 14, ink);
  drawRight(page, formatDate(order.created_at, settings.locale), PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 82, regular, 8.5, muted);

  page.drawRectangle({ x: MARGIN, y: y - 112, width: PAGE_WIDTH - MARGIN * 2, height: 112, color: paper });
  page.drawText("DATOS DEL CLIENTE", { x: MARGIN + 16, y: y - 22, font: bold, size: 8, color: accent });
  page.drawText(pdfText(order.customer_name), { x: MARGIN + 16, y: y - 43, font: bold, size: 12, color: ink });
  page.drawText(pdfText(order.phone), { x: MARGIN + 16, y: y - 61, font: regular, size: 9.5, color: muted });
  if (order.customer_email) {
    page.drawText(pdfText(order.customer_email), { x: MARGIN + 16, y: y - 78, font: regular, size: 9.5, color: muted });
  }

  const deliveryX = MARGIN + 270;
  page.drawText("ENTREGA", { x: deliveryX, y: y - 22, font: bold, size: 8, color: accent });
  page.drawText(order.delivery_method === "pickup" ? "Retiro acordado" : "Envío a domicilio", { x: deliveryX, y: y - 43, font: bold, size: 10, color: ink });
  const addressLines = wrapText(order.delivery_method === "pickup" ? "Coordinación directa con el cliente" : order.address || "Sin dirección", regular, 9, PAGE_WIDTH - MARGIN - deliveryX - 16).slice(0, 4);
  addressLines.forEach((addressLine, index) => {
    page.drawText(addressLine, { x: deliveryX, y: y - 61 - index * 12, font: regular, size: 9, color: muted });
  });
  y -= 137;

  page.drawText("DETALLE DE LA ORDEN", { x: MARGIN, y, font: bold, size: 9, color: accent });
  y -= 24;
  page.drawRectangle({ x: MARGIN, y: y - 24, width: PAGE_WIDTH - MARGIN * 2, height: 24, color: ink });
  page.drawText("Producto", { x: MARGIN + 10, y: y - 16, font: bold, size: 8, color: rgb(1, 1, 1) });
  drawRight(page, "Cant.", 398, y - 16, bold, 8, rgb(1, 1, 1));
  drawRight(page, "Precio", 480, y - 16, bold, 8, rgb(1, 1, 1));
  drawRight(page, "Subtotal", PAGE_WIDTH - MARGIN - 10, y - 16, bold, 8, rgb(1, 1, 1));
  y -= 24;

  for (const item of items) {
    const productLines = wrapText(item.product_name, bold, 10, 260).slice(0, 2);
    const meta = [item.variant_name, item.sku].filter(Boolean).join(" - ");
    const rowHeight = Math.max(43, 17 + productLines.length * 12 + (meta ? 12 : 0));
    ensureSpace(rowHeight + 4);
    productLines.forEach((productLine, index) => {
      page.drawText(productLine, { x: MARGIN + 10, y: y - 16 - index * 12, font: bold, size: 10, color: ink });
    });
    if (meta) {
      page.drawText(pdfText(meta), { x: MARGIN + 10, y: y - 17 - productLines.length * 12, font: regular, size: 7.5, color: muted });
    }
    drawRight(page, String(item.quantity), 398, y - 18, regular, 9.5, ink);
    drawRight(page, formatMoney(item.price_cents, order.currency, settings.locale), 480, y - 18, regular, 9, ink);
    drawRight(page, formatMoney(item.subtotal_cents, order.currency, settings.locale), PAGE_WIDTH - MARGIN - 10, y - 18, bold, 9, ink);
    page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: PAGE_WIDTH - MARGIN, y: y - rowHeight }, thickness: 0.7, color: line });
    y -= rowHeight;
  }

  const notesLines = order.notes ? wrapText(order.notes, regular, 9, 300).slice(0, 5) : [];
  ensureSpace(126 + notesLines.length * 12);
  y -= 20;
  const totalsX = PAGE_WIDTH - MARGIN - 190;
  page.drawText("Subtotal", { x: totalsX, y, font: regular, size: 10, color: muted });
  drawRight(page, formatMoney(order.subtotal_cents, order.currency, settings.locale), PAGE_WIDTH - MARGIN, y, regular, 10, ink);
  y -= 24;
  page.drawLine({ start: { x: totalsX, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: line });
  y -= 27;
  page.drawText("TOTAL", { x: totalsX, y, font: bold, size: 12, color: ink });
  drawRight(page, formatMoney(order.total_cents, order.currency, settings.locale), PAGE_WIDTH - MARGIN, y, bold, 16, accent);

  const statusText = statusLabel(order.status);
  page.drawText("Estado", { x: MARGIN, y: y + 25, font: regular, size: 8, color: muted });
  page.drawText(pdfText(statusText), { x: MARGIN, y, font: bold, size: 11, color: ink });
  if (notesLines.length) {
    page.drawText("Notas", { x: MARGIN, y: y - 27, font: bold, size: 8, color: muted });
    notesLines.forEach((noteLine, index) => {
      page.drawText(noteLine, { x: MARGIN, y: y - 43 - index * 12, font: regular, size: 9, color: ink });
    });
  }

  const socialParts = [
    settings.whatsappActive && settings.whatsappNumber ? `WhatsApp: +${settings.whatsappNumber.replace(/\D/g, "")}` : "",
    settings.instagramActive && settings.instagramUrl ? `Instagram: ${compactLink(settings.instagramUrl)}` : "",
    settings.facebookActive && settings.facebookUrl ? `Facebook: ${compactLink(settings.facebookUrl)}` : "",
    settings.supportEmail ? `Correo: ${settings.supportEmail}` : "",
  ].filter(Boolean);
  page.drawLine({ start: { x: MARGIN, y: 70 }, end: { x: PAGE_WIDTH - MARGIN, y: 70 }, thickness: 0.8, color: line });
  page.drawText("Gracias por tu compra.", { x: MARGIN, y: 51, font: bold, size: 9, color: ink });
  const footerLines = wrapText(socialParts.join("  |  "), regular, 7.5, PAGE_WIDTH - MARGIN * 2).slice(0, 2);
  footerLines.forEach((footerLine, index) => {
    page.drawText(footerLine, { x: MARGIN, y: 36 - index * 10, font: regular, size: 7.5, color: muted });
  });
  drawPageNumber(page);

  return document.save();
}
