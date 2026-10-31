import { useState } from "react";
import { q, exec } from "../../lib/db";
import { fmtMoney, fmtNum, todayISO } from "../../lib/format";
import { useSettings } from "../../lib/settingsContext";
import { genererCodeBarres } from "../../lib/barcode";
import type { Categorie, Produit } from "../../lib/types";
import Modal, { Bouton, Champ, inputCls } from "../../components/Modal";

/**
 * Création d'un lot : un type de produit (catégorie), un poids par pièce,
 * un nombre de pièces et un prix au kg. Le lot reçoit un code-barres unique
 * et ses étiquettes (une par pièce) sont prêtes à imprimer.
 */
export default function NouveauLot({
  categories,
  categorieDefaut = null,
  onFermer,
  onCree,
}: {
  categories: Categorie[];
  categorieDefaut?: number | null;
  onFermer: () => void;
  onCree: (produit: Produit) => void;
}) {
  const { devise } = useSettings();
  const [catId, setCatId] = useState<number | "">(categorieDefaut ?? categories[0]?.id ?? "");
  const [nom, setNom] = useState("");
  const [poids, setPoids] = useState("");
  const [pieces, setPieces] = useState("1");
  const [prixKg, setPrixKg] = useState("");
  const [achatKg, setAchatKg] = useState("");
  const [dateFab, setDateFab] = useState(todayISO());
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const num = (s: string) => parseFloat(s.replace(",", ".")) || 0;
  const cat = categories.find((c) => c.id === catId);
  // Une catégorie en « unité » n'est pas pesée : on retombe sur le kg
  const unite = !cat || cat.unite_defaut === "unité" ? "kg" : cat.unite_defaut;
  const p = num(poids);
  const nb = Math.max(1, Math.floor(num(pieces)));
  const prixPiece = p * num(prixKg);
  const achatPiece = p * num(achatKg);
  const totalLot = prixPiece * nb;

  async function valider() {
    setErreur(null);
    if (categories.length === 0) return setErreur("Créez d'abord une catégorie.");
    if (!cat) return setErreur("Choisissez le type de produit (catégorie).");
    if (p <= 0) return setErreur("Saisissez un poids supérieur à 0.");
    if (num(prixKg) <= 0) return setErreur("Saisissez le prix de vente au kg.");
    if (num(pieces) < 1) return setErreur("Indiquez au moins 1 pièce.");
    if (!dateFab) return setErreur("Indiquez la date de fabrication.");

    setEnCours(true);
    try {
      const poidsTxt = String(p).replace(".", ",");
      const nomFinal = nom.trim() || `${cat.nom} ${poidsTxt} ${unite}`;
      const code = await genererCodeBarres(cat.id);

      await exec(
        `INSERT INTO produits
           (nom, code_barres, categorie_id, fournisseur_id, prix_achat, prix_vente,
            stock, seuil_alerte, unite, poids, date_fabrication)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 'pièce', ?, ?)`,
        [nomFinal, code, cat.id, achatPiece, prixPiece, nb, p, dateFab],
      );

      await exec(
        `INSERT INTO mouvements_stock (produit_id, type, quantite, motif)
         SELECT id, 'entree', ?, ? FROM produits WHERE code_barres = ?`,
        [
          nb,
          `Lot : ${poidsTxt} ${unite} × ${nb} (fab. ${dateFab.split("-").reverse().join("/")})`,
          code,
        ],
      );

      const [produit] = await q<Produit>("SELECT * FROM produits WHERE code_barres = ?", [code]);
      if (!produit) throw new Error("Produit introuvable après enregistrement.");
      onCree(produit);
    } catch (e) {
      setErreur(`Enregistrement impossible : ${String(e)}`);
      setEnCours(false);
    }
  }

  return (
    <Modal
      titre="📦 Nouveau lot"
      onFermer={onFermer}
      pied={
        <>
          <Bouton variante="secondaire" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton onClick={valider} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer + étiquettes"}
          </Bouton>
        </>
      }
    >
      <div className="space-y-3">
        {erreur && (
          <p className="text-red-700 bg-red-50 rounded-lg px-3 py-2 text-sm">{erreur}</p>
        )}

        <Champ label="Type de produit *">
          <select
            value={catId}
            onChange={(e) => setCatId(e.target.value ? Number(e.target.value) : "")}
            className={inputCls}
            autoFocus
          >
            {categories.length === 0 && <option value="">— Créez une catégorie d'abord —</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </Champ>

        <div className="grid grid-cols-2 gap-3">
          <Champ label={`Poids par pièce (${unite}) *`}>
            <input
              value={poids}
              onChange={(e) => setPoids(e.target.value)}
              inputMode="decimal"
              placeholder="1,53"
              className={inputCls}
            />
          </Champ>
          <Champ label="Nombre de pièces *">
            <input
              value={pieces}
              onChange={(e) => setPieces(e.target.value)}
              inputMode="numeric"
              placeholder="1"
              className={inputCls}
            />
          </Champ>
        </div>

        <Champ label="Nom du produit (facultatif)">
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            className={inputCls}
            placeholder={
              cat
                ? `${cat.nom} ${poids ? poids.replace(".", ",") : "…"} ${unite}`
                : "Généré automatiquement"
            }
          />
        </Champ>

        <div className="grid grid-cols-2 gap-3">
          <Champ label={`Prix de vente / ${unite} *`}>
            <input
              value={prixKg}
              onChange={(e) => setPrixKg(e.target.value)}
              inputMode="decimal"
              placeholder="12,00"
              className={inputCls}
            />
          </Champ>
          <Champ label={`Prix d'achat / ${unite}`}>
            <input
              value={achatKg}
              onChange={(e) => setAchatKg(e.target.value)}
              inputMode="decimal"
              placeholder="8,00 (facultatif)"
              className={inputCls}
            />
          </Champ>
        </div>

        <Champ label="Date de fabrication *">
          <input
            type="date"
            value={dateFab}
            onChange={(e) => setDateFab(e.target.value)}
            className={inputCls}
          />
        </Champ>

        {/* Récapitulatif */}
        <div className="rounded-lg bg-slate-50 border px-3 py-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Produit</span>
            <span className="font-medium">
              {nom.trim() ||
                (cat ? `${cat.nom} ${poids ? `${poids.replace(".", ",")} ${unite}` : ""}` : "…")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Code-barres</span>
            <span className="font-mono text-xs text-slate-600">
              généré automatiquement (préfixe catégorie)
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Prix d'une pièce ({fmtNum(p)} {unite})</span>
            <span className="font-semibold">{fmtMoney(prixPiece, devise)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">
              Lot de {nb} pièce{nb > 1 ? "s" : ""}
            </span>
            <span className="font-bold text-blue-700">{fmtMoney(totalLot, devise)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Étiquettes à imprimer</span>
            <span className="font-medium">{nb}</span>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Chaque étiquette affichera : <b>type de produit</b>, <b>poids</b>, <b>date de fabrication</b>,
          prix et code-barres.
        </p>
      </div>
    </Modal>
  );
}
