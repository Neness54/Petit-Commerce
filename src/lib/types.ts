export interface Produit {
  id: number;
  nom: string;
  code_barres: string | null;
  categorie_id: number | null;
  fournisseur_id: number | null;
  prix_achat: number;
  prix_vente: number;
  stock: number;
  seuil_alerte: number;
  unite: string;
  poids: number | null;
  date_fabrication: string | null;
  actif: number;
  cree_le: string;
}

export interface Categorie {
  id: number;
  nom: string;
  unite_defaut: string;
  parent_id: number | null;
}

export interface Fournisseur {
  id: number;
  nom: string;
  contact: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
}

export interface Client {
  id: number;
  nom: string;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  plafond_credit: number;
  actif: number;
  cree_le: string;
  dette?: number;
}

export interface Vente {
  id: number;
  numero: string;
  client_id: number | null;
  montant_total: number;
  montant_paye: number;
  montant_recu: number | null;
  mode_paiement: string;
  annulee: number;
  cree_le: string;
  client_nom?: string | null;
}

export interface LigneVente {
  id: number;
  vente_id: number;
  produit_id: number;
  nom_produit: string;
  quantite: number;
  prix_unitaire: number;
  prix_achat: number;
}

export interface Commande {
  id: number;
  fournisseur_id: number;
  statut: string;
  date_creation: string;
  date_reception: string | null;
  total: number;
  notes: string | null;
  fournisseur_nom?: string;
}

export interface LigneCommande {
  id: number;
  commande_id: number;
  produit_id: number;
  quantite: number;
  prix_achat: number;
  produit_nom?: string;
  unite?: string;
}

export interface Mouvement {
  id: number;
  produit_id: number;
  type: string;
  quantite: number;
  motif: string | null;
  reference: string | null;
  cree_le: string;
  produit_nom?: string;
}

export interface Paiement {
  id: number;
  client_id: number;
  montant: number;
  motif: string;
  vente_id: number | null;
  cree_le: string;
}

export type Settings = Record<string, string>;

export const MOUVEMENT_TYPES: Record<string, { label: string; couleur: string }> = {
  entree: { label: "Entrée", couleur: "text-green-700 bg-green-50" },
  sortie: { label: "Sortie", couleur: "text-red-700 bg-red-50" },
  ajustement: { label: "Ajustement", couleur: "text-blue-700 bg-blue-50" },
  vente: { label: "Vente", couleur: "text-orange-700 bg-orange-50" },
  vente_annulee: { label: "Vente annulée", couleur: "text-slate-700 bg-slate-100" },
  commande_recue: { label: "Commande reçue", couleur: "text-purple-700 bg-purple-50" },
};

export const STATUTS_COMMANDE: Record<string, { label: string; couleur: string }> = {
  brouillon: { label: "Brouillon", couleur: "text-slate-700 bg-slate-100" },
  commandee: { label: "Commandée", couleur: "text-blue-700 bg-blue-100" },
  recue: { label: "Reçue", couleur: "text-green-700 bg-green-100" },
  annulee: { label: "Annulée", couleur: "text-red-700 bg-red-100" },
};
