import { q } from "./db";

/**
 * Préfixe lisible et stable dérivé du nom de la catégorie.
 * « Lard » → LARD, « Saumon fumé » → SAUM, « Épicerie » → EPIC.
 */
export function prefixeCategorie(nom: string | null | undefined): string {
  const base = (nom ?? "PROD")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return (base || "PROD").slice(0, 4).padEnd(4, "X");
}

/**
 * Génère un code-barres unique du type « LARD-0007 », où le préfixe
 * correspond au type de produit (catégorie) et le numéro au produit.
 * Code128 accepte lettres, chiffres et tirets : scannable tel quel.
 */
export async function genererCodeBarres(categorieId: number | null): Promise<string> {
  let prefixe = "PROD";
  if (categorieId != null) {
    const [cat] = await q<{ nom: string }>("SELECT nom FROM categories WHERE id = ?", [
      categorieId,
    ]);
    if (cat) prefixe = prefixeCategorie(cat.nom);
  }

  const [row] = await q<{ n: number }>("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM produits");
  let n = Number(row?.n ?? 1);

  for (let essai = 0; essai < 1000; essai++, n++) {
    const code = `${prefixe}-${String(n).padStart(4, "0")}`;
    const deja = await q("SELECT 1 FROM produits WHERE code_barres = ?", [code]);
    if (deja.length === 0) return code;
  }
  // Filet de sécurité (très improbable)
  return `${prefixe}-${Date.now().toString().slice(-6)}`;
}
