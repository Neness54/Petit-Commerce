-- Migration 6 : informations entreprise pour facture
INSERT OR IGNORE INTO parametres (cle, valeur) VALUES
  ('entreprise_nom', ''),
  ('entreprise_adresse', ''),
  ('entreprise_telephone', ''),
  ('entreprise_email', ''),
  ('entreprise_siret', ''),
  ('entreprise_logo', '');
