-- Migration 3 : poids d'une pesée (lot vendu à la pièce)
-- NULL = produit classique (stocké par quantité), renseigné = bloc pesé (ex. Lard 1,53 kg)
ALTER TABLE produits ADD COLUMN poids REAL;
