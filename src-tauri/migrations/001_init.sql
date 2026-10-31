-- Migration 1 : schéma initial de la base de données

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS produits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  code_barres TEXT UNIQUE,
  categorie_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  prix_achat REAL NOT NULL DEFAULT 0,
  prix_vente REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0,
  seuil_alerte REAL NOT NULL DEFAULT 0,
  unite TEXT NOT NULL DEFAULT 'unité',
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS fournisseurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  contact TEXT,
  telephone TEXT,
  email TEXT,
  adresse TEXT
);

CREATE TABLE IF NOT EXISTS commandes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
  statut TEXT NOT NULL DEFAULT 'brouillon', -- brouillon | commandee | recue | annulee
  date_creation TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  date_reception TEXT,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS lignes_commande (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produits(id),
  quantite REAL NOT NULL,
  prix_achat REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  telephone TEXT,
  email TEXT,
  plafond_credit REAL NOT NULL DEFAULT 0, -- 0 = pas de crédit autorisé
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ventes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  montant_total REAL NOT NULL,
  montant_paye REAL NOT NULL DEFAULT 0,
  mode_paiement TEXT NOT NULL DEFAULT 'espece', -- espece | credit
  annulee INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS lignes_vente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vente_id INTEGER NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produits(id),
  nom_produit TEXT NOT NULL,       -- figé à la vente
  quantite REAL NOT NULL,
  prix_unitaire REAL NOT NULL,
  prix_achat REAL NOT NULL         -- figé à la vente (pour la marge)
);

CREATE TABLE IF NOT EXISTS paiements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  montant REAL NOT NULL,
  motif TEXT NOT NULL DEFAULT 'remboursement',
  vente_id INTEGER REFERENCES ventes(id) ON DELETE SET NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS mouvements_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  type TEXT NOT NULL,               -- entree | sortie | ajustement | vente | vente_annulee | commande_recue
  quantite REAL NOT NULL,           -- signée : positive = entrée, négative = sortie
  motif TEXT,
  reference TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS parametres (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);

-- Paramètres par défaut
INSERT OR IGNORE INTO parametres (cle, valeur) VALUES
  ('nom_commerce', 'Mon Commerce'),
  ('devise', 'EUR'),
  ('message_ticket', 'Merci de votre visite !'),
  ('pin_caisse', '');  -- SHA-256 du PIN, vide = pas de PIN

-- Catégorie par défaut
INSERT OR IGNORE INTO categories (nom) VALUES ('Général');

CREATE INDEX IF NOT EXISTS idx_produits_code_barres ON produits(code_barres);
CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(cree_le);
CREATE INDEX IF NOT EXISTS idx_lignes_vente_vente ON lignes_vente(vente_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_produit ON mouvements_stock(produit_id);
CREATE INDEX IF NOT EXISTS idx_paiements_client ON paiements(client_id);
