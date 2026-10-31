import { useEffect, useState } from "react";
import { q, exec } from "../../lib/db";
import { fmtNum } from "../../lib/format";
import { prefixeCategorie } from "../../lib/barcode";
import type { Categorie } from "../../lib/types";
import Modal, { Bouton, Champ, inputCls } from "../../components/Modal";

interface CatStat extends Categorie {
  nb_produits: number;
  stock_total: number;
  alertes: number;
  parent_nom?: string | null;
}

const UNITES = ["unité", "pièce", "kg", "g", "L", "ml", "lot", "paquet", "bouteille", "boîte"];

/** Types de produits : création, renommage, unité par défaut et statistiques */
export default function Categories() {
  const [cats, setCats] = useState<CatStat[]>([]);
  const [edit, setEdit] = useState<CatStat | "nouvelle" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = async () => {
    setCats(
      await q<CatStat>(
        `SELECT c.*,
           p.nom AS parent_nom,
           COUNT(prod.id) AS nb_produits,
           COALESCE(SUM(COALESCE(prod.poids * prod.stock, prod.stock)), 0) AS stock_total,
           COALESCE(SUM(CASE WHEN prod.poids IS NULL AND prod.stock <= prod.seuil_alerte THEN 1 ELSE 0 END), 0) AS alertes
         FROM categories c
         LEFT JOIN categories p ON p.id = c.parent_id
         LEFT JOIN produits prod ON prod.categorie_id = c.id AND prod.actif = 1
         GROUP BY c.id
         ORDER BY COALESCE(p.nom, c.nom) COLLATE NOCASE, c.parent_id IS NULL DESC, c.nom COLLATE NOCASE`,
      ),
    );
  };
  useEffect(() => {
    charger();
  }, []);

  async function supprimer(c: CatStat) {
    const texte =
      c.nb_produits > 0
        ? `Supprimer « ${c.nom} » ? Ses ${c.nb_produits} produit(s) passeront en « Sans catégorie » (aucune donnée n'est perdue).`
        : `Supprimer la catégorie « ${c.nom} » ?`;
    if (!window.confirm(texte)) return;
    setErreur(null);
    try {
      await exec("DELETE FROM categories WHERE id = ?", [c.id]);
      charger();
    } catch (e) {
      setErreur(`Suppression impossible : ${String(e)}`);
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold">Catégories de produits</h2>
        <p className="text-sm text-slate-500">
          Organisez vos produits en catégories et sous-catégories (ex. « Charcuterie » →
          « Jambon »).
        </p>
        <div className="ml-auto">
          <Bouton onClick={() => setEdit("nouvelle")}>+ Nouvelle catégorie</Bouton>
        </div>
      </div>

      {erreur && (
        <p className="text-red-700 bg-red-50 rounded-lg px-3 py-2 text-sm">{erreur}</p>
      )}

      {cats.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <span className="text-5xl mb-3">🗂</span>
          <p>Aucune catégorie pour l'instant.</p>
          <p className="text-sm mt-1">Créez « Lard », « Saumon »… pour organiser votre stock.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {cats.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-xl border p-4 flex flex-col gap-2 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-2">
                  <span className="text-2xl">{c.parent_id ? "↳" : "🗂"}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg truncate" title={c.nom}>
                      {c.parent_id ? `Sous-catégorie : ${c.nom}` : c.nom}
                    </h3>
                    <span className="text-xs text-slate-500">
                      {c.parent_id ? (
                        <>
                          Rattachée à <b>{c.parent_nom}</b> · Unité par défaut : <b>{c.unite_defaut}</b>
                        </>
                      ) : (
                        <>
                          Unité par défaut : <b>{c.unite_defaut}</b>
                        </>
                      )}
                    </span>
                  </div>
                  {c.alertes > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                      ⚠ {c.alertes}
                    </span>
                  )}
                </div>

                <div className="flex gap-2 mt-1">
                  <div className="flex-1 bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                    <div className="text-lg font-bold">{c.nb_produits}</div>
                    <div className="text-[11px] text-slate-500">produit(s)</div>
                  </div>
                  <div className="flex-1 bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                    <div className="text-lg font-bold">{fmtNum(c.stock_total)}</div>
                    <div className="text-[11px] text-slate-500">{c.unite_defaut} en stock</div>
                  </div>
                </div>

                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => setEdit(c)}
                    className="flex-1 text-sm py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200"
                  >
                    ✏ Modifier
                  </button>
                  <button
                    onClick={() => supprimer(c)}
                    className="text-sm py-1.5 px-3 rounded-lg text-red-600 hover:bg-red-50"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {edit && (
        <FormCategorie
          categorie={edit === "nouvelle" ? null : edit}
          onFermer={() => setEdit(null)}
          onEnregistre={() => {
            setEdit(null);
            charger();
          }}
        />
      )}
    </div>
  );
}

function FormCategorie({
  categorie,
  onFermer,
  onEnregistre,
}: {
  categorie: CatStat | null;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [cats, setCats] = useState<Categorie[]>([]);
  const [nom, setNom] = useState(categorie?.nom ?? "");
  const [unite, setUnite] = useState(categorie?.unite_defaut ?? "kg");
  const [parentId, setParentId] = useState<number | "">(categorie?.parent_id ?? "");
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    q<Categorie>("SELECT * FROM categories ORDER BY nom COLLATE NOCASE").then(setCats);
  }, []);

  const parents = cats.filter((c) => c.id !== categorie?.id && c.parent_id == null);

  async function sauver() {
    setErreur(null);
    if (!nom.trim()) return setErreur("Le nom est obligatoire.");
    if (categorie && parentId === categorie.id) {
      return setErreur("Une catégorie ne peut pas être sa propre sous-catégorie.");
    }
    try {
      if (categorie) {
        await exec("UPDATE categories SET nom = ?, unite_defaut = ?, parent_id = ? WHERE id = ?", [
          nom.trim(),
          unite,
          parentId === "" ? null : parentId,
          categorie.id,
        ]);
      } else {
        await exec("INSERT INTO categories (nom, unite_defaut, parent_id) VALUES (?, ?, ?)", [
          nom.trim(),
          unite,
          parentId === "" ? null : parentId,
        ]);
      }
      onEnregistre();
    } catch (e) {
      setErreur(
        /UNIQUE|unique/i.test(String(e))
          ? "Cette catégorie existe déjà."
          : `Enregistrement impossible : ${String(e)}`,
      );
    }
  }

  return (
    <Modal
      titre={categorie ? `Modifier — ${categorie.nom}` : "Nouvelle catégorie"}
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
      <div className="space-y-3">
        {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
        <Champ label="Nom du type de produit *">
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            className={inputCls}
            placeholder="Ex : Lard, Saumon, Volaille…"
            autoFocus
          />
        </Champ>
        <Champ label="Catégorie parente (facultatif)">
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}
            className={inputCls}
          >
            <option value="">— Aucune (catégorie principale) —</option>
            {parents.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Unité par défaut (proposée à la création d'un produit)">
          <select value={unite} onChange={(e) => setUnite(e.target.value)} className={inputCls}>
            {UNITES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Champ>
        <p className="text-xs text-slate-500">
          Les codes-barres générés pour les produits de cette catégorie utiliseront le préfixe{" "}
          <b className="font-mono">{prefixeCategorie(nom)}-…</b>
        </p>
      </div>
    </Modal>
  );
}
