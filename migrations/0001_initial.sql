PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  item_type TEXT NOT NULL DEFAULT 'physical' CHECK (item_type IN ('physical', 'service')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  compare_at_cents INTEGER CHECK (compare_at_cents IS NULL OR compare_at_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX products_category_idx ON products(category_id);
CREATE INDEX products_active_idx ON products(active, featured);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  object_key TEXT,
  url TEXT NOT NULL,
  alt TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX product_images_product_idx ON product_images(product_id, position);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  attributes_json TEXT,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  track_inventory INTEGER NOT NULL DEFAULT 1 CHECK (track_inventory IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX product_variants_product_idx ON product_variants(product_id, active);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'delivered', 'cancelled')),
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  delivery_method TEXT NOT NULL DEFAULT 'delivery',
  address TEXT,
  notes TEXT,
  subtotal_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX orders_status_idx ON orders(status, created_at DESC);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  sku TEXT,
  price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  subtotal_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX order_items_order_idx ON order_items(order_id);

CREATE TRIGGER confirm_order_stock
BEFORE UPDATE OF status ON orders
WHEN NEW.status = 'confirmed' AND OLD.status = 'pending'
BEGIN
  SELECT (CASE
    WHEN EXISTS (
      SELECT 1
      FROM order_items oi
      JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = NEW.id
        AND pv.track_inventory = 1
      GROUP BY pv.id
      HAVING pv.stock < SUM(oi.quantity)
    )
    THEN RAISE(ABORT, 'Inventario insuficiente para confirmar la orden')
  END);

  UPDATE product_variants
  SET stock = stock - (
    SELECT COALESCE(SUM(oi.quantity), 0)
    FROM order_items oi
    WHERE oi.order_id = NEW.id AND oi.variant_id = product_variants.id
  ), updated_at = CURRENT_TIMESTAMP
  WHERE track_inventory = 1
    AND id IN (SELECT variant_id FROM order_items WHERE order_id = NEW.id);
END;

CREATE TRIGGER cancel_confirmed_order_stock
BEFORE UPDATE OF status ON orders
WHEN NEW.status = 'cancelled' AND OLD.status = 'confirmed'
BEGIN
  UPDATE product_variants
  SET stock = stock + (
    SELECT COALESCE(SUM(oi.quantity), 0)
    FROM order_items oi
    WHERE oi.order_id = NEW.id AND oi.variant_id = product_variants.id
  ), updated_at = CURRENT_TIMESTAMP
  WHERE track_inventory = 1
    AND id IN (SELECT variant_id FROM order_items WHERE order_id = NEW.id);
END;

INSERT INTO settings (key, value) VALUES
  ('brand_name', 'Línea Base'),
  ('tagline', 'Prendas esenciales, elegidas con intención.'),
  ('description', 'Una tienda de moda contemporánea creada sobre una plantilla rápida, flexible y lista para crecer.'),
  ('whatsapp_number', '584121234567'),
  ('currency', 'USD'),
  ('locale', 'es-VE'),
  ('accent_color', '#d95d39'),
  ('support_email', 'hola@lineabase.store'),
  ('announcement', 'Envíos nacionales · Atención personalizada por WhatsApp');

INSERT INTO categories (id, name, slug, sort_order) VALUES
  ('cat-esenciales', 'Esenciales', 'esenciales', 1),
  ('cat-superiores', 'Superiores', 'superiores', 2),
  ('cat-accesorios', 'Accesorios', 'accesorios', 3);

INSERT INTO products (id, name, slug, description, category_id, price_cents, compare_at_cents, featured) VALUES
  ('prod-camisa-lino', 'Camisa de lino', 'camisa-de-lino', 'Lino liviano, corte relajado y detalles limpios. Una pieza versátil para todos los días.', 'cat-superiores', 4800, 5800, 1),
  ('prod-camiseta-base', 'Camiseta Base', 'camiseta-base', 'Algodón de alto gramaje con una silueta contemporánea y tacto suave.', 'cat-esenciales', 2600, NULL, 1),
  ('prod-pantalon-fluido', 'Pantalón fluido', 'pantalon-fluido', 'Cintura cómoda y caída amplia para acompañar el movimiento.', 'cat-esenciales', 5400, NULL, 0),
  ('prod-bolso-nudo', 'Bolso Nudo', 'bolso-nudo', 'Bolso compacto de textura suave con correa ajustable.', 'cat-accesorios', 3900, 4500, 0);

INSERT INTO product_images (id, product_id, url, alt, position) VALUES
  ('img-lino', 'prod-camisa-lino', '/placeholders/camisa-lino.svg', 'Camisa de lino color arena', 0),
  ('img-camiseta', 'prod-camiseta-base', '/placeholders/camiseta-base.svg', 'Camiseta básica terracota', 0),
  ('img-pantalon', 'prod-pantalon-fluido', '/placeholders/pantalon-fluido.svg', 'Pantalón fluido oscuro', 0),
  ('img-bolso', 'prod-bolso-nudo', '/placeholders/bolso-nudo.svg', 'Bolso con nudo', 0);

INSERT INTO product_variants (id, product_id, label, sku, attributes_json, stock) VALUES
  ('var-lino-s', 'prod-camisa-lino', 'S · Arena', 'LIN-ARE-S', '{"talla":"S","color":"Arena"}', 6),
  ('var-lino-m', 'prod-camisa-lino', 'M · Arena', 'LIN-ARE-M', '{"talla":"M","color":"Arena"}', 9),
  ('var-lino-l', 'prod-camisa-lino', 'L · Arena', 'LIN-ARE-L', '{"talla":"L","color":"Arena"}', 4),
  ('var-base-s', 'prod-camiseta-base', 'S · Terracota', 'BAS-TER-S', '{"talla":"S","color":"Terracota"}', 12),
  ('var-base-m', 'prod-camiseta-base', 'M · Terracota', 'BAS-TER-M', '{"talla":"M","color":"Terracota"}', 14),
  ('var-base-l', 'prod-camiseta-base', 'L · Terracota', 'BAS-TER-L', '{"talla":"L","color":"Terracota"}', 8),
  ('var-pantalon-s', 'prod-pantalon-fluido', 'S · Carbón', 'PAN-CAR-S', '{"talla":"S","color":"Carbón"}', 5),
  ('var-pantalon-m', 'prod-pantalon-fluido', 'M · Carbón', 'PAN-CAR-M', '{"talla":"M","color":"Carbón"}', 7),
  ('var-pantalon-l', 'prod-pantalon-fluido', 'L · Carbón', 'PAN-CAR-L', '{"talla":"L","color":"Carbón"}', 5),
  ('var-bolso', 'prod-bolso-nudo', 'Única · Avellana', 'BOL-AVE-U', '{"talla":"Única","color":"Avellana"}', 10);
