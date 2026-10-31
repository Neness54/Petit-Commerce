import { useEffect, useMemo, useState } from "react";
import { q, exec } from "../../lib/db";
import { fmtDateTime, fmtNum } from "../../lib/format";
import { saveCSV } from "../../lib/export";
import { genererCodeBarres } from "../../lib/barcode";
import {
  MOUVEMENT_TYPES,
  type Categorie,
  type Fournisseur,
  type Mouvement,
  type Produit,
} from "../../lib/types";
import Modal, { Bouton, Champ, inputCls } from "../../components/Modal";
import FormProduit from "../../components/FormProduit";
import ImpressionEtiquettes from "../../components/ImpressionEtiquettes";
import NouveauLot from "./NouveauLot";

interface Groupe {
  id: number | null;
  nom: string;
  unite: string;
  produits: Produit[];
  stock: number;
  alertes: number;
}

/** Quantité totale d'un groupe : poids × pièces pour un lot pesé, sinon stock */
function quantiteGroupe(ps: Produit[]): number {
  return ps.reduce((s, p) => s + (p.poids != null ? p.poids * p.stock : p.stock), 0);
}

/** Alertes : un bloc pesé déjà vendu n'est pas une rupture de stock */
function alertesGroupe(ps: Produit[]): number {
  return ps.filter((p) => p.poids == null && p.stock <= p.seuil_alerte).length;
}

/** Stock organisé par type de produit (catégorie) + journal des mouvements */
export default function Stock() {
  const [onglet, setOnglet] = useState<"stock" | "journal">("stock");
  const [produits, setProduits] = useState<Produit[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [recherche, setRecherche] = useState("");
  const [alertesSeule, setAlertesSeule] = useState(false);
  const [masquerEpuises, setMasquerEpuises] = useState(true);
  const [replies, setReplies] = useState<Record<string, boolean>>({});

  const [lot, setLot] = useState<{ categorieId?: number | null } | null>(null);
  const [mouvement, setMouvement] = useState<{ produit?: Produit } | null>(null);
  const [formProduit, setFormProduit] = useState<Produit | null>(null);
  const [etiquettes, setEtiquettes] = useState<{ produits: Produit[]; quantite?: number } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const charger = async () => {
    const [ps, cs, fs, ms] = await Promise.all([
      q<Produit>("SELECT * FROM produits WHERE actif = 1 ORDER BY nom COLLATE NOCASE"),
      q<Categorie>("SELECT * FROM categories ORDER BY nom COLLATE NOCASE"),
      q<Fournisseur>("SELECT * FROM fournisseurs ORDER BY nom COLLATE NOCASE"),
      q<Mouvement>(
        `SELECT m.*, p.nom AS produit_nom FROM mouvements_stock m
         JOIN produits p ON p.id = m.produit_id
         ORDER BY m.id DESC LIMIT 100`,
      ),
    ]);
    setProduits(ps);
    setCategories(cs);
    setFournisseurs(fs);
    setMouvements(ms);
  };
  useEffect(() => {
    charger();
  }, []);

  /** Groupes = catégories, produits rangés dedans (les vides restent affichées) */
  const groupes = useMemo<Groupe[]>(() => {
    const r = recherche.trim().toLowerCase();
    const filtres = produits.filter((p) => {
      if (masquerEpuises && p.stock <= 0) return false;
      if (alertesSeule && p.stock > p.seuil_alerte) return false;
      if (r && !p.nom.toLowerCase().includes(r) && !(p.code_barres ?? "").toLowerCase().includes(r))
        return false;
      return true;
    });

    const parCat = new Map<number | null, Produit[]>();
    for (const p of filtres) {
      const liste = parCat.get(p.categorie_id) ?? [];
      liste.push(p);
      parCat.set(p.categorie_id, liste);
    }

    const parentMap = new Map<number, Categorie>();
    for (const c of categories) parentMap.set(c.id, c);

    const res: Groupe[] = [];
    for (const c of categories) {
      const aDesSousCats = categories.some((sc) => sc.parent_id === c.id);
      if (aDesSousCats) continue;
      const ps = parCat.get(c.id);
      if ((!ps || ps.length === 0) && (r || alertesSeule)) continue;
      const parent = c.parent_id ? parentMap.get(c.parent_id) : null;
      res.push({
        id: c.id,
        nom: parent ? `${parent.nom} → ${c.nom}` : c.nom,
        unite: c.unite_defaut,
        produits: ps ?? [],
        stock: quantiteGroupe(ps ?? []),
        alertes: alertesGroupe(ps ?? []),
      });
    }
    const orphelins = parCat.get(null);
    if (orphelins && orphelins.length > 0) {
      res.push({
        id: null,
        nom: "Sans catégorie",
        unite: "unité",
        produits: orphelins,
        stock: quantiteGroupe(orphelins),
        alertes: alertesGroupe(orphelins),
      });
    }
    return res;
  }, [produits, categories, recherche, alertesSeule, masquerEpuises]);

  const totalAffiche = groupes.reduce((s, g) => s + g.produits.length, 0);
  const estReplie = (g: Groupe) => replies[String(g.id)] ?? false;
  const basculer = (g: Groupe) =>
    setReplies((r) => ({ ...r, [String(g.id)]: !estReplie(g) }));

  /** Génère et enregistre un code-barres unique lié à la catégorie */
  async function genererCode(p: Produit) {
    const code = await genererCodeBarres(p.categorie_id);
    await exec("UPDATE produits SET code_barres = ? WHERE id = ?", [code, p.id]);
    setMessage(`Code-barres généré pour ${p.nom} : ${code}`);
    charger();
  }

  /** Remplace un code existant (les étiquettes déjà imprimées ne seront plus valables) */
  async function regenererCode(p: Produit) {
    if (
      !window.confirm(
        `Régénérer le code-barres de « ${p.nom} » ?\nL'ancien code (${p.code_barres}) et les étiquettes déjà imprimées ne seront plus valables.`,
      )
    )
      return;
    await genererCode(p);
  }

  async function supprimer(p: Produit) {
    if (!window.confirm(`Désactiver « ${p.nom} » ? (l'historique des ventes est conservé)`)) return;
    await exec("UPDATE produits SET actif = 0 WHERE id = ?", [p.id]);
    charger();
  }

  async function exporter() {
    await saveCSV(
      "mouvements_stock.csv",
      ["Date", "Produit", "Type", "Quantité", "Motif", "Référence"],
      mouvements.map((m) => [
        fmtDateTime(m.cree_le),
        m.produit_nom ?? "",
        MOUVEMENT_TYPES[m.type]?.label ?? m.type,
        m.quantite,
        m.motif ?? "",
        m.reference ?? "",
      ]),
    );
  }

  const tousAffiches = groupes.flatMap((g) => g.produits);

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xl font-bold mr-2">Stock & lots</h2>
        <div className="flex bg-slate-200 rounded-lg p-0.5">
          {(
            [
              ["stock", "📦 Par catégorie"],
              ["journal", "🧾 Journal"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setOnglet(id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                onglet === id ? "bg-white shadow-sm text-slate-900" : "text-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {onglet === "stock" && (
          <>
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher un produit…"
              className="border rounded-lg px-3 py-1.5 w-56"
            />
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={alertesSeule}
                onChange={(e) => setAlertesSeule(e.target.checked)}
              />
              Alertes seulement
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={masquerEpuises}
                onChange={(e) => setMasquerEpuises(e.target.checked)}
              />
              Masquer les épuisés
            </label>
          </>
        )}
        <div className="ml-auto flex gap-2">
          {onglet === "journal" && (
            <Bouton variante="discret" onClick={exporter}>
              ⬇ CSV
            </Bouton>
          )}
          {onglet === "stock" && (
            <Bouton
              variante="discret"
              onClick={() => setEtiquettes({ produits: tousAffiches.slice(0, 40) })}
              disabled={tousAffiches.length === 0}
              title="Imprimer des étiquettes code-barres"
            >
              🏷 Étiquettes
            </Bouton>
          )}
          <Bouton variante="discret" onClick={() => setMouvement({})}>
            ± Mouvement
          </Bouton>
          <Bouton onClick={() => setLot({})}>📦 Nouveau lot</Bouton>
        </div>
      </div>

      {message && (
        <div className="flex items-center gap-3 bg-green-50 text-green-800 rounded-lg px-3 py-2 text-sm">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="ml-auto text-green-700 hover:underline">
            OK
          </button>
        </div>
      )}

      {onglet === "stock" ? (
        <div className="flex-1 overflow-y-auto space-y-3">
          {groupes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <span className="text-5xl mb-3">📦</span>
              <p>Aucun produit ne correspond.</p>
            </div>
          ) : (
            groupes.map((g) => (
              <section key={String(g.id)} className="bg-white rounded-xl border overflow-hidden">
                {/* En-tête de catégorie */}
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b">
                  <button
                    onClick={() => basculer(g)}
                    className="text-slate-400 hover:text-slate-700 w-6 text-center"
                    title={estReplie(g) ? "Déplier" : "Replier"}
                  >
                    {estReplie(g) ? "▸" : "▾"}
                  </button>
                  <span className="text-lg">🗂</span>
                  <h3 className="font-semibold text-lg">{g.nom}</h3>
                  <span className="text-xs text-slate-500">
                    {g.produits.length} produit{g.produits.length > 1 ? "s" : ""}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white border text-slate-600">
                    {fmtNum(g.stock)} {g.unite} en stock
                  </span>
                  {g.alertes > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      ⚠ {g.alertes} alerte{g.alertes > 1 ? "s" : ""}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    <button
                      onClick={() => setLot({ categorieId: g.id })}
                      className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5"
                      title="Créer un lot dans cette catégorie"
                    >
                      📦 Nouveau lot
                    </button>
                  </div>
                </div>

                {!estReplie(g) &&
                  (g.produits.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-slate-400 text-center">
                      Aucun produit dans cette catégorie.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-slate-500">
                        <tr className="border-b">
                          <th className="text-left px-4 py-2 font-medium">Produit</th>
                          <th className="text-left px-4 py-2 font-medium">Code-barres</th>
                          <th className="text-right px-4 py-2 font-medium">Stock</th>
                          <th className="text-right px-4 py-2 font-medium">Seuil</th>
                          <th className="text-left px-4 py-2 font-medium">État</th>
                          <th className="px-4 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.produits.map((p) => {
                          const alerte = p.stock <= p.seuil_alerte;
                          const rupture = p.stock <= 0;
                          return (
                            <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50">
                              <td className="px-4 py-2">
                                <span className="font-medium">{p.nom}</span>
                              </td>
                              <td className="px-4 py-2">
                                {p.code_barres ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span className="font-mono text-xs text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">
                                      {p.code_barres}
                                    </span>
                                    <button
                                      onClick={() => regenererCode(p)}
                                      className="text-slate-400 hover:text-blue-600 text-xs"
                                      title="Régénérer le code selon la catégorie"
                                    >
                                      🎲
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => genererCode(p)}
                                    className="text-xs text-blue-600 hover:underline"
                                    title="Générer un code lié à la catégorie"
                                  >
                                    🎲 Générer un code
                                  </button>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <span
                                  className={`font-bold ${rupture ? "text-red-700" : alerte ? "text-orange-600" : "text-slate-800"}`}
                                >
                                  {fmtNum(p.stock)}
                                </span>
                                <span className="text-slate-400 text-xs"> {p.unite}</span>
                              </td>
                              <td className="px-4 py-2 text-right text-slate-500">
                                {fmtNum(p.seuil_alerte)} {p.unite}
                              </td>
                              <td className="px-4 py-2">
                                {rupture && p.poids != null ? (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                    Vendu
                                  </span>
                                ) : rupture ? (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                                    Rupture
                                  </span>
                                ) : alerte ? (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                                    Stock bas
                                  </span>
                                ) : (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                    OK
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right whitespace-nowrap">
                                <button
                                  onClick={() => setMouvement({ produit: p })}
                                  className="text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded px-2 py-1 mr-2"
                                >
                                  ± Ajuster
                                </button>
                                <button
                                  onClick={() => setEtiquettes({ produits: [p] })}
                                  className="text-slate-500 hover:text-blue-600 text-xs mr-2"
                                  title="Imprimer une étiquette"
                                >
                                  🏷
                                </button>
                                <button
                                  onClick={() => setFormProduit(p)}
                                  className="text-blue-600 hover:underline text-xs mr-2"
                                >
                                  Modifier
                                </button>
                                <button
                                  onClick={() => supprimer(p)}
                                  className="text-red-600 hover:underline text-xs"
                                >
                                  Désactiver
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ))}
              </section>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 bg-white rounded-xl border flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="font-semibold">Journal des mouvements (100 derniers)</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {mouvements.length === 0 ? (
              <p className="text-slate-400 text-center mt-10">Aucun mouvement.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">Produit</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-right px-4 py-2">Qté</th>
                    <th className="text-left px-4 py-2">Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {mouvements.map((m) => {
                    const meta = MOUVEMENT_TYPES[m.type] ?? {
                      label: m.type,
                      couleur: "bg-slate-100",
                    };
                    return (
                      <tr key={m.id} className="border-t">
                        <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                          {fmtDateTime(m.cree_le)}
                        </td>
                        <td className="px-4 py-2 font-medium">{m.produit_nom}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${meta.couleur}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-semibold ${m.quantite >= 0 ? "text-green-700" : "text-red-700"}`}
                        >
                          {m.quantite >= 0 ? "+" : ""}
                          {fmtNum(m.quantite)}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{m.motif ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {lot && (
        <NouveauLot
          categories={categories}
          categorieDefaut={lot.categorieId ?? null}
          onFermer={() => setLot(null)}
          onCree={(p) => {
            setLot(null);
            charger();
            setEtiquettes({ produits: [p], quantite: p.stock });
            setMessage(`Lot créé : ${p.nom} × ${fmtNum(p.stock)} — code ${p.code_barres}`);
          }}
        />
      )}

      {mouvement && (
        <ModalMouvement
          produits={produits}
          produitInitial={mouvement.produit}
          onFermer={() => setMouvement(null)}
          onFait={() => {
            setMouvement(null);
            charger();
          }}
        />
      )}

      {formProduit && (
        <FormProduit
          produit={formProduit}
          categories={categories}
          fournisseurs={fournisseurs}
          onFermer={() => setFormProduit(null)}
          onEnregistre={() => {
            setFormProduit(null);
            charger();
          }}
        />
      )}

      {etiquettes && (
        <ImpressionEtiquettes
          produits={etiquettes.produits}
          quantiteInitiale={etiquettes.quantite}
          onFermer={() => setEtiquettes(null)}
        />
      )}
    </div>
  );
}

/** Saisie d'entrée / sortie / ajustement de stock */
function ModalMouvement({
  produits,
  produitInitial,
  onFermer,
  onFait,
}: {
  produits: Produit[];
  produitInitial?: Produit;
  onFermer: () => void;
  onFait: () => void;
}) {
  const [produitId, setProduitId] = useState<number | "">(produitInitial?.id ?? "");
  const [type, setType] = useState<"entree" | "sortie" | "ajustement">("entree");
  const [quantite, setQuantite] = useState("");
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const produitSel = produits.find((p) => p.id === produitId);

  async function enregistrer() {
    setErreur(null);
    const qte = parseFloat(quantite.replace(",", "."));
    if (produitId === "") return setErreur("Choisissez un produit.");
    if (!qte || (type !== "ajustement" && qte <= 0)) return setErreur("Quantité invalide.");

    if (type === "ajustement") {
      const delta = qte - (produitSel?.stock ?? 0);
      await exec("UPDATE produits SET stock = ? WHERE id = ?", [qte, produitId]);
      await exec(
        `INSERT INTO mouvements_stock (produit_id, type, quantite, motif) VALUES (?, 'ajustement', ?, ?)`,
        [produitId, delta, motif || `Inventaire : fixé à ${qte}`],
      );
    } else {
      if (type === "sortie" && qte > (produitSel?.stock ?? 0)) {
        return setErreur(`Stock insuffisant (disponible : ${fmtNum(produitSel?.stock ?? 0)}).`);
      }
      const signe = type === "entree" ? 1 : -1;
      await exec("UPDATE produits SET stock = stock + ? WHERE id = ?", [signe * qte, produitId]);
      await exec(
        `INSERT INTO mouvements_stock (produit_id, type, quantite, motif) VALUES (?, ?, ?, ?)`,
        [
          produitId,
          type,
          signe * qte,
          motif || (type === "entree" ? "Entrée manuelle" : "Sortie manuelle"),
        ],
      );
    }
    onFait();
  }

  return (
    <Modal
      titre="Mouvement de stock"
      onFermer={onFermer}
      pied={
        <>
          <Bouton variante="secondaire" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton onClick={enregistrer}>Enregistrer</Bouton>
        </>
      }
    >
      <div className="space-y-3">
        {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
        <Champ label="Produit">
          <select
            value={produitId}
            onChange={(e) => setProduitId(e.target.value ? Number(e.target.value) : "")}
            className={inputCls}
          >
            <option value="">— Choisir —</option>
            {produits.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom} ({fmtNum(p.stock)} {p.unite})
              </option>
            ))}
          </select>
        </Champ>

        <Champ label="Type de mouvement">
          <div className="grid grid-cols-3 gap-1.5">
            {(["entree", "sortie", "ajustement"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`py-2 rounded-lg text-sm font-medium border-2 ${
                  type === t
                    ? t === "entree"
                      ? "border-green-600 bg-green-50 text-green-800"
                      : t === "sortie"
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-blue-500 bg-blue-50 text-blue-800"
                    : "border-slate-200 text-slate-500"
                }`}
              >
                {t === "entree" ? "📥 Entrée" : t === "sortie" ? "📤 Sortie" : "🔢 Ajust."}
              </button>
            ))}
          </div>
        </Champ>

        <Champ label={type === "ajustement" ? "Nouveau stock (valeur réelle)" : "Quantité"}>
          <input
            value={quantite}
            onChange={(e) => setQuantite(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className={inputCls}
          />
        </Champ>

        {produitSel && (
          <p className="text-xs text-slate-500">
            Stock actuel :{" "}
            <b>
              {fmtNum(produitSel.stock)} {produitSel.unite}
            </b>
            {type === "ajustement" && quantite && (
              <>
                {" "}
                → mouvement de{" "}
                <b>
                  {(() => {
                    const d = (parseFloat(quantite.replace(",", ".")) || 0) - produitSel.stock;
                    return `${d >= 0 ? "+" : ""}${fmtNum(d)} ${produitSel.unite}`;
                  })()}
                </b>
              </>
            )}
          </p>
        )}

        <Champ label="Motif (facultatif)">
          <input
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            className={inputCls}
            placeholder="Ex : livraison, casse, inventaire…"
          />
        </Champ>
      </div>
    </Modal>
  );
}
