import type { CartItem } from "./types";

const CART_KEY = "tiendita:cart:v1";

export function readCart(): CartItem[] {
  try {
    const value = localStorage.getItem(CART_KEY);
    return value ? (JSON.parse(value) as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("cart:updated", { detail: items }));
}

export function addToCart(item: CartItem) {
  const items = readCart();
  const current = items.find((entry) => entry.variantId === item.variantId);

  if (current) {
    const nextQuantity = current.quantity + item.quantity;
    current.quantity = item.maxQuantity
      ? Math.min(nextQuantity, item.maxQuantity)
      : nextQuantity;
  } else {
    items.push(item);
  }

  writeCart(items);
  return items;
}

export function clearCart() {
  writeCart([]);
}
