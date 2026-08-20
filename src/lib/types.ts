export type ProductVariant = {
  id: string;
  productId: string;
  label: string;
  sku: string;
  attributes: Record<string, string>;
  priceCents: number | null;
  stock: number;
  trackInventory: boolean;
  active: boolean;
};

export type ProductImage = {
  id: string;
  url: string;
  alt: string;
  position: number;
};

export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  itemType: "physical" | "service";
  priceCents: number;
  compareAtCents: number | null;
  active: boolean;
  featured: boolean;
  images: ProductImage[];
  variants: ProductVariant[];
};

export type CartItem = {
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  variant: string;
  sku: string;
  priceCents: number;
  quantity: number;
  maxQuantity: number | null;
  image: string;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
};
