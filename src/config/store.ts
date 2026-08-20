export const storeDefaults = {
  brandName: "Línea Base",
  logoUrl: "",
  tagline: "Prendas esenciales, elegidas con intención.",
  description:
    "Una tienda de moda contemporánea creada sobre una plantilla rápida, flexible y lista para crecer.",
  heroTitle: "Línea Base",
  heroSubtitle: "Prendas esenciales, elegidas con intención.",
  heroImageUrl: "/placeholders/hero-editorial.svg",
  loginImageUrl: "",
  whatsappNumber: "584121234567",
  whatsappActive: true,
  instagramUrl: "",
  instagramActive: false,
  facebookUrl: "",
  facebookActive: false,
  currency: "USD",
  locale: "es-VE",
  accentColor: "#d95d39",
  supportEmail: "hola@lineabase.store",
  announcement: "Envíos nacionales · Atención personalizada por WhatsApp",
};

export type StoreSettings = typeof storeDefaults;
