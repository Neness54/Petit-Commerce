-- Migration 4 : facturation
-- Coordonnées du client (facture) + montant réellement reçu en espèces
ALTER TABLE clients ADD COLUMN adresse TEXT;
ALTER TABLE ventes ADD COLUMN montant_recu REAL;

-- Reprise des anciennes ventes : le montant payé était le montant en espèces
UPDATE ventes
   SET montant_recu = CASE
         WHEN mode_paiement = 'espece' THEN montant_paye
         ELSE montant_total
       END
 WHERE montant_recu IS NULL;
