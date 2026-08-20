CREATE TABLE catalog_operations (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('import', 'google_sync')),
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  row_count INTEGER NOT NULL DEFAULT 0,
  created_products INTEGER NOT NULL DEFAULT 0,
  updated_products INTEGER NOT NULL DEFAULT 0,
  created_variants INTEGER NOT NULL DEFAULT 0,
  updated_variants INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX catalog_operations_operation_created_idx
  ON catalog_operations(operation, created_at DESC);
