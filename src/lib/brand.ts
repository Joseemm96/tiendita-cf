export function getBrandInitials(brandName: string) {
  const words = brandName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "TI";

  const initials = words.length === 1
    ? words[0].slice(0, 2)
    : `${words[0][0]}${words.at(-1)?.[0] ?? ""}`;

  return initials.toLocaleUpperCase("es");
}

export function getBrandFavicon(brandName: string, accentColor: string) {
  const initials = getBrandInitials(brandName)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const background = /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : "#171714";
  const fontSize = initials.length > 1 ? 25 : 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${background}"/><text x="32" y="34" fill="#fffdf8" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
