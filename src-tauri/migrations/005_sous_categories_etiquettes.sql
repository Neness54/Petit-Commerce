-- Migration 5 : sous-catégories + info étiquette
ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE produits ADD COLUMN date_fabrication TEXT;

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
