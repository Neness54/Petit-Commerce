-- Migration 2 : unité par défaut des catégories (ex. kg pour Lard / Saumon)
ALTER TABLE categories ADD COLUMN unite_defaut TEXT NOT NULL DEFAULT 'unité';
