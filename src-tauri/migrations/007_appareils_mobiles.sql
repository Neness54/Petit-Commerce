-- Migration 7 : appareils mobiles appairés (persistance des jetons)
CREATE TABLE IF NOT EXISTS appareils_mobiles (
  token TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  cree_le TEXT DEFAULT (datetime('now', 'localtime'))
);
