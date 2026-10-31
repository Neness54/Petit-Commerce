import { useState } from "react";
import { q, exec } from "../lib/db";
import { genererCodeBarres } from "../lib/barcode";
import type { Categorie, Fournisseur, Produit } from "../lib/types";
import Modal, { Bouton, Champ, inputCls } from "./Modal";

const UNITES = ["unité", "pièce", "kg", "g", "L", "ml", "lot", "paquet", "bouteille", "boîte"];

/** Ajout / modification d'un produit simple (utilisé par Stock & lots) */
export default function FormProduit({
  produit,
  categories,
  fournisseurs,
  categorieDefaut = null,
  onFermer,
  onEnregistre,
}: {
  produit: Produit | null;
  categories: Categorie[];
  fournisseurs: Fournisseur[];
  categorieDefaut?: number | null;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [nom, setNom] = useState(produit?.nom ?? "");
  const [codeBarres, setCodeBarres] = useState(produit?.code_barres ?? "");
  const [categorieId, setCategorieId] = useState<number | "">(
    produit?.categorie_id ?? categorieDefaut ?? "",
  );
  const [fournisseurId, setFournisseurId] = useState<number | "">(produit?.fournisseur_id ?? "");
  const [prixAchat, setPrixAchat] = useState(
    produit ? String(produit.prix_achat).replace(".", ",") : "",
  );
  const [prixVente, setPrixVente] = useState(
    produit ? String(produit.prix_vente).replace(".", ",") : "",
  );
  const [stock, setStock] = useState(produit ? String(produit.stock).replace(".", ",") : "0");
  const [seuil, setSeuil] = useState(produit ? String(produit.seuil_alerte).replace(".", ",") : "0");
  const [unite, setUnite] = useState(
    produit?.unite ??
      categories.find((c) => c.id === categorieDefaut)?.unite_defaut ??
      "unité",
  );
  const [nouvelleCat, setNouvelleCat] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const num = (s: string) => parseFloat(s.replace(",", ".")) || 0;

  function changerCategorie(valeur: string) {
    const id = valeur ? Number(valeur) : "";
    setCategorieId(id);
    // Nouveau produit : on adopte l'unité par défaut de la catégorie
    if (!produit && id !== "") {
      const cat = categories.find((c) => c.id === id);
      if (cat?.unite_defaut) setUnite(cat.unite_defaut);
    }
  }

  async function genererCode() {
    const catId = categorieId === "" ? null : categorieId;
    setCodeBarres(await genererCodeBarres(catId));
  }

  async function sauver() {
    setErreur(null);
    if (!nom.trim()) return setErreur("Le nom est obligatoire.");
    if (num(prixVente) <= 0) return setErreur("Le prix de vente doit être supérieur à 0.");

    try {
      let catId: number | null = categorieId === "" ? null : categorieId;
      if (nouvelleCat.trim()) {
        await exec("INSERT OR IGNORE INTO categories (nom, unite_defaut) VALUES (?, ?)", [
          nouvelleCat.trim(),
          unite,
        ]);
        const [c] = await q<Categorie>("SELECT * FROM categories WHERE nom = ?", [
          nouvelleCat.trim(),
        ]);
        catId = c?.id ?? null;
      }

      // Code-barres : généré automatiquement selon la catégorie s'il est vide
      let code = codeBarres.trim();
      if (!code) code = await genererCodeBarres(catId);

      const params = [
        nom.trim(),
        code,
        catId,
        fournisseurId === "" ? null : fournisseurId,
        num(prixAchat),
        num(prixVente),
        num(seuil),
        unite.trim() || "unité",
      ];

      if (produit) {
        await exec(
          `UPDATE produits SET nom=?, code_barres=?, categorie_id=?, fournisseur_id=?,
           prix_achat=?, prix_vente=?, seuil_alerte=?, unite=? WHERE id=?`,
          [...params, produit.id],
        );
        // Ajustement du stock via mouvement tracé
        const delta = num(stock) - produit.stock;
        if (Math.abs(delta) > 0.0001) {
          await exec("UPDATE produits SET stock = ? WHERE id = ?", [num(stock), produit.id]);
          await exec(
            `INSERT INTO mouvements_stock (produit_id, type, quantite, motif) VALUES (?, 'ajustement', ?, ?)`,
            [produit.id, delta, "Correction fiche produit"],
          );
        }
      } else {
        const res = (await exec(
          `INSERT INTO produits (nom, code_barres, categorie_id, fournisseur_id, prix_achat, prix_vente, stock, seuil_alerte, unite)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...params.slice(0, 5), num(stock), ...params.slice(5)],
        )) as { lastInsertId?: number | bigint };
        const id = Number(res?.lastInsertId ?? 0);
        if (id && num(stock) !== 0) {
          await exec(
            `INSERT INTO mouvements_stock (produit_id, type, quantite, motif) VALUES (?, 'entree', ?, 'Stock initial')`,
            [id, num(stock)],
          );
        }
      }
      onEnregistre();
    } catch (e) {
      const msg = String(e);
      setErreur(
        /UNIQUE|unique/i.test(msg)
          ? "Ce code-barres est déjà utilisé par un autre produit."
          : `Enregistrement impossible : ${msg}`,
      );
    }
  }

  return (
    <Modal
      titre={produit ? `Modifier — ${produit.nom}` : "Nouveau produit"}
      onFermer={onFermer}
      pied={
        <>
          <Bouton variante="secondaire" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton onClick={sauver}>Enregistrer</Bouton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {erreur && <p className="col-span-2 text-red-600 text-sm">{erreur}</p>}
        <div className="col-span-2">
          <Champ label="Nom *">
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              className={inputCls}
              placeholder="Ex : Lard, Saumon…"
              autoFocus
            />
          </Champ>
        </div>
        <Champ label="Catégorie (type de produit)">
          <select
            value={categorieId}
            onChange={(e) => changerCategorie(e.target.value)}
            className={inputCls}
          >
            <option value="">— Aucune —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Nouvelle catégorie (si besoin)">
          <input
            value={nouvelleCat}
            onChange={(e) => setNouvelleCat(e.target.value)}
            className={inputCls}
            placeholder="Ex : Volaille"
          />
        </Champ>
        <div className="col-span-2">
          <Champ label="Code-barres (généré selon la catégorie si vide)">
            <div className="flex gap-2">
              <input
                value={codeBarres}
                onChange={(e) => setCodeBarres(e.target.value)}
                className={inputCls}
                placeholder="Scanner, saisir ou générer…"
              />
              <button
                type="button"
                onClick={genererCode}
                className="px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm whitespace-nowrap"
                title="Générer un code lié à la catégorie (ex. LARD-0007)"
              >
                🎲 Générer
              </button>
            </div>
          </Champ>
        </div>
        <Champ label="Fournisseur">
          <select
            value={fournisseurId}
            onChange={(e) => setFournisseurId(e.target.value ? Number(e.target.value) : "")}
            className={inputCls}
          >
            <option value="">— Aucun —</option>
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Unité">
          <select value={unite} onChange={(e) => setUnite(e.target.value)} className={inputCls}>
            {UNITES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Prix d'achat">
          <input
            value={prixAchat}
            onChange={(e) => setPrixAchat(e.target.value)}
            inputMode="decimal"
            className={inputCls}
          />
        </Champ>
        <Champ label="Prix de vente *">
          <input
            value={prixVente}
            onChange={(e) => setPrixVente(e.target.value)}
            inputMode="decimal"
            className={inputCls}
          />
        </Champ>
        <Champ label={produit ? "Stock actuel" : "Stock initial"}>
          <input
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            inputMode="decimal"
            className={inputCls}
            disabled={!!produit}
            title={produit ? "Modifiez le stock via l'onglet Stock (tracé)" : ""}
          />
        </Champ>
        <Champ label="Seuil d'alerte">
          <input
            value={seuil}
            onChange={(e) => setSeuil(e.target.value)}
            inputMode="decimal"
            className={inputCls}
          />
        </Champ>
      </div>
    </Modal>
  );
}
