import { useEffect, useState } from "react";
import { q, exec, tx, type Stmt } from "../../lib/db";
import { fmtDateTime, fmtMoney, fmtNum } from "../../lib/format";
import { useSettings } from "../../lib/settingsContext";
import {
  STATUTS_COMMANDE,
  type Commande,
  type Fournisseur,
  type LigneCommande,
  type Produit,
} from "../../lib/types";
import Modal, { Bouton, Champ, inputCls } from "../../components/Modal";

/** Bons de commande fournisseurs */
export default function Commandes() {
  const { devise } = useSettings();
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [detail, setDetail] = useState<Commande | null>(null);
  const [nouvelle, setNouvelle] = useState<{ fournisseurId: number; lignes: LigneProposee[] } | null>(null);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);

  const charger = async () => {
    setCommandes(
      await q<Commande>(
        `SELECT co.*, f.nom AS fournisseur_nom FROM commandes co
         JOIN fournisseurs f ON f.id = co.fournisseur_id
         ORDER BY co.id DESC`,
      ),
    );
    setFournisseurs(await q<Fournisseur>("SELECT * FROM fournisseurs ORDER BY nom"));
  };
  useEffect(() => {
    charger();
  }, []);

  /** Créer une commande à partir des produits en alerte pour un fournisseur */
  async function commanderDepuisAlertes() {
    if (fournisseurs.length === 0) {
      alert("Créez d'abord un fournisseur (onglet Fournisseurs).");
      return;
    }
    const fid = fournisseurs[0].id;
    await creerCommandeDepuisAlertes(fid);
  }

  async function creerCommandeDepuisAlertes(fournisseurId: number) {
    const alertes = await q<Produit>(
      `SELECT * FROM produits WHERE actif = 1 AND stock <= seuil_alerte
         AND (fournisseur_id = ? OR ? = 0)
       ORDER BY nom`,
      [fournisseurId, fournisseurId],
    );
    const lignes: LigneProposee[] = alertes.map((p) => ({
      produit: p,
      qte: Math.max(1, Math.ceil(p.seuil_alerte * 2 - p.stock)),
      prixAchat: p.prix_achat,
    }));
    setNouvelle({ fournisseurId, lignes });
  }

  async function supprimer(c: Commande) {
    if (c.statut === "recue") {
      alert("Une commande déjà reçue ne peut pas être supprimée (le stock a été mis à jour).");
      return;
    }
    if (!window.confirm(`Supprimer la commande n°${c.id} ?`)) return;
    await exec("DELETE FROM commandes WHERE id = ?", [c.id]); // lignes supprimées en cascade
    charger();
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold">Commandes fournisseurs</h2>
        <div className="ml-auto flex gap-2">
          <Bouton
            variante="discret"
            onClick={commanderDepuisAlertes}
            title="Préparer une commande avec les produits en alerte"
          >
            ⚠️ Depuis les alertes de stock
          </Bouton>
          <Bouton
            onClick={() => {
              if (fournisseurs.length === 0) {
                alert("Créez d'abord un fournisseur (onglet Fournisseurs).");
                return;
              }
              setNouvelle({ fournisseurId: fournisseurs[0].id, lignes: [] });
            }}
          >
            + Nouvelle commande
          </Bouton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-xl border">
        {commandes.length === 0 ? (
          <p className="text-slate-400 text-center mt-10">Aucune commande.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2">N°</th>
                <th className="text-left px-4 py-2">Fournisseur</th>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Statut</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {commandes.map((c) => {
                const meta = STATUTS_COMMANDE[c.statut] ?? { label: c.statut, couleur: "bg-slate-100" };
                return (
                  <tr key={c.id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono">#{c.id}</td>
                    <td className="px-4 py-2 font-medium">{c.fournisseur_nom}</td>
                    <td className="px-4 py-2">{fmtDateTime(c.date_creation)}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${meta.couleur}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {fmtMoney(c.total, devise)}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setDetail(c)}
                        className="text-blue-600 hover:underline text-xs mr-3"
                      >
                        Détails
                      </button>
                      {c.statut !== "recue" && (
                        <button
                          onClick={() => supprimer(c)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <DetailCommande
          commande={detail}
          onFermer={() => {
            setDetail(null);
            charger();
          }}
        />
      )}
      {nouvelle && (
        <FormCommande
          fournisseurs={fournisseurs}
          fournisseurInitial={nouvelle.fournisseurId}
          lignesInitiales={nouvelle.lignes}
          onFermer={() => setNouvelle(null)}
          onEnregistre={() => {
            setNouvelle(null);
            charger();
          }}
        />
      )}
    </div>
  );
}

interface LigneProposee {
  produit: Produit;
  qte: number;
  prixAchat: number;
}

/** Formulaire de création de commande */
function FormCommande({
  fournisseurs,
  fournisseurInitial,
  lignesInitiales,
  onFermer,
  onEnregistre,
}: {
  fournisseurs: Fournisseur[];
  fournisseurInitial: number;
  lignesInitiales: LigneProposee[];
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const { devise } = useSettings();
  const [fournisseurId, setFournisseurId] = useState(fournisseurInitial);
  const [lignes, setLignes] = useState<LigneProposee[]>(lignesInitiales);
  const [recherche, setRecherche] = useState("");
  const [notes, setNotes] = useState("");
  const [produits, setProduits] = useState<Produit[]>([]);

  useEffect(() => {
    q<Produit>("SELECT * FROM produits WHERE actif = 1 ORDER BY nom COLLATE NOCASE").then(setProduits);
  }, []);

  // Quand le fournisseur change, recharger les alertes de ce fournisseur
  async function changerFournisseur(fid: number) {
    setFournisseurId(fid);
    if (lignes.length > 0) {
      if (!window.confirm("Remplacer les lignes actuelles par les alertes de ce fournisseur ?"))
        return;
    }
    const alertes = await q<Produit>(
      `SELECT * FROM produits WHERE actif = 1 AND stock <= seuil_alerte
         AND (fournisseur_id = ? OR ? = 0) ORDER BY nom`,
      [fid, fid],
    );
    setLignes(
      alertes.map((p) => ({
        produit: p,
        qte: Math.max(1, Math.ceil(p.seuil_alerte * 2 - p.stock)),
        prixAchat: p.prix_achat,
      })),
    );
  }

  const total = lignes.reduce((s, l) => s + l.qte * l.prixAchat, 0);
  const produitsFiltres = produits
    .filter((p) => p.nom.toLowerCase().includes(recherche.toLowerCase()))
    .slice(0, 8);

  function ajouterProduit(p: Produit) {
    setLignes((ls) => {
      const i = ls.findIndex((l) => l.produit.id === p.id);
      if (i >= 0) {
        const copie = [...ls];
        copie[i] = { ...copie[i], qte: copie[i].qte + 1 };
        return copie;
      }
      return [...ls, { produit: p, qte: 1, prixAchat: p.prix_achat }];
    });
    setRecherche("");
  }

  async function sauver(statut: "brouillon" | "commandee") {
    if (lignes.length === 0) return alert("Ajoutez au moins un produit.");
    // La 1re statement insère la commande ; les lignes la référencent par une sous-requête sur le dernier id
    const statements: Stmt[] = [
      {
        sql: "INSERT INTO commandes (fournisseur_id, statut, total, notes) VALUES (?, ?, ?, ?)",
        params: [fournisseurId, statut, total, notes || null],
      },
    ];
    for (const l of lignes) {
      statements.push({
        sql: `INSERT INTO lignes_commande (commande_id, produit_id, quantite, prix_achat)
              VALUES ((SELECT MAX(id) FROM commandes), ?, ?, ?)`,
        params: [l.produit.id, l.qte, l.prixAchat],
      });
    }
    await tx(statements);
    onEnregistre();
  }

  return (
    <Modal
      titre="Nouvelle commande"
      onFermer={onFermer}
      large
      pied={
        <>
          <Bouton variante="secondaire" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="discret" onClick={() => sauver("brouillon")}>
            💾 Brouillon
          </Bouton>
          <Bouton variante="primaire" onClick={() => sauver("commandee")}>
            ✔ Valider la commande
          </Bouton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <Champ label="Fournisseur">
            <select
              value={fournisseurId}
              onChange={(e) => changerFournisseur(Number(e.target.value))}
              className={inputCls}
            >
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputCls}
              rows={2}
              placeholder="Ex : livraison attendue vendredi"
            />
          </Champ>
          <Champ label="Ajouter un produit">
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className={inputCls}
              placeholder="Tapez un nom…"
            />
          </Champ>
          {recherche && (
            <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
              {produitsFiltres.length === 0 ? (
                <p className="text-xs text-slate-400 px-3 py-2">Aucun produit.</p>
              ) : (
                produitsFiltres.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => ajouterProduit(p)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50"
                  >
                    {p.nom}{" "}
                    <span className="text-slate-400">
                      (stock : {fmtNum(p.stock)}, achat : {fmtMoney(p.prix_achat, devise)})
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div>
          <h4 className="text-sm font-medium text-slate-600 mb-2">Lignes ({lignes.length})</h4>
          {lignes.length === 0 ? (
            <p className="text-xs text-slate-400">
              Aucune ligne. Cherchez des produits à gauche, ou utilisez « Depuis les alertes ».
            </p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {lignes.map((l, i) => (
                <div key={l.produit.id} className="flex items-center gap-2 text-sm border rounded-lg px-2 py-1.5">
                  <span className="flex-1 truncate">{l.produit.nom}</span>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    value={l.qte}
                    onChange={(e) => {
                      const copie = [...lignes];
                      copie[i] = { ...l, qte: parseFloat(e.target.value) || 0 };
                      setLignes(copie);
                    }}
                    className="w-16 border rounded px-1.5 py-1"
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={l.prixAchat}
                    onChange={(e) => {
                      const copie = [...lignes];
                      copie[i] = { ...l, prixAchat: parseFloat(e.target.value) || 0 };
                      setLignes(copie);
                    }}
                    className="w-20 border rounded px-1.5 py-1"
                    title="Prix d'achat unitaire"
                  />
                  <span className="w-20 text-right font-medium">
                    {fmtMoney(l.qte * l.prixAchat, devise)}
                  </span>
                  <button
                    onClick={() => setLignes(lignes.filter((_, j) => j !== i))}
                    className="text-red-500 hover:text-red-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex justify-between font-bold text-sm pt-2 border-t">
                <span>Total</span>
                <span>{fmtMoney(total, devise)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Détail d'une commande : réception, annulation */
function DetailCommande({
  commande,
  onFermer,
}: {
  commande: Commande;
  onFermer: () => void;
}) {
  const { devise } = useSettings();
  const [lignes, setLignes] = useState<LigneCommande[]>([]);

  useEffect(() => {
    q<LigneCommande>(
      `SELECT lc.*, p.nom AS produit_nom, p.unite FROM lignes_commande lc
       JOIN produits p ON p.id = lc.produit_id
       WHERE lc.commande_id = ?`,
      [commande.id],
    ).then(setLignes);
  }, [commande.id]);

  async function receptionner() {
    const ok = window.confirm(
      `Réceptionner la commande n°${commande.id} ? Le stock sera mis à jour et les prix d'achat ajustés.`,
    );
    if (!ok) return;
    const statements: Stmt[] = [];
    for (const l of lignes) {
      statements.push({
        sql: "UPDATE produits SET stock = stock + ?, prix_achat = ? WHERE id = ?",
        params: [l.quantite, l.prix_achat, l.produit_id],
      });
      statements.push({
        sql: "INSERT INTO mouvements_stock (produit_id, type, quantite, motif, reference) VALUES (?, 'commande_recue', ?, ?, ?)",
        params: [l.produit_id, l.quantite, `Réception commande #${commande.id}`, `CMD-${commande.id}`],
      });
    }
    statements.push({
      sql: "UPDATE commandes SET statut = 'recue', date_reception = datetime('now','localtime') WHERE id = ?",
      params: [commande.id],
    });
    await tx(statements);
    onFermer();
  }

  async function annuler() {
    if (!window.confirm(`Annuler la commande n°${commande.id} ?`)) return;
    await exec("UPDATE commandes SET statut = 'annulee' WHERE id = ?", [commande.id]);
    onFermer();
  }

  const meta = STATUTS_COMMANDE[commande.statut] ?? { label: commande.statut, couleur: "bg-slate-100" };

  return (
    <Modal
      titre={`Commande #${commande.id} — ${commande.fournisseur_nom ?? ""}`}
      onFermer={onFermer}
      pied={
        <>
          <Bouton variante="secondaire" onClick={onFermer}>
            Fermer
          </Bouton>
          {(commande.statut === "brouillon" || commande.statut === "commandee") && (
            <>
              <Bouton variante="danger" onClick={annuler}>
                Annuler la commande
              </Bouton>
              <Bouton variante="succes" onClick={receptionner}>
                📦 Réceptionner (met à jour le stock)
              </Bouton>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex gap-4 text-slate-600">
          <span>
            Statut :{" "}
            <span className={`px-2 py-0.5 rounded-full ${meta.couleur}`}>{meta.label}</span>
          </span>
          <span>Créée le : {fmtDateTime(commande.date_creation)}</span>
          {commande.date_reception && <span>Reçue le : {fmtDateTime(commande.date_reception)}</span>}
        </div>
        {commande.notes && <p className="text-slate-500 italic">« {commande.notes} »</p>}

        <table className="w-full">
          <thead className="text-slate-500 border-b">
            <tr>
              <th className="text-left py-2">Produit</th>
              <th className="text-right py-2">Quantité</th>
              <th className="text-right py-2">Prix achat</th>
              <th className="text-right py-2">Sous-total</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-2">{l.produit_nom}</td>
                <td className="py-2 text-right">
                  {fmtNum(l.quantite)} {l.unite}
                </td>
                <td className="py-2 text-right">{fmtMoney(l.prix_achat, devise)}</td>
                <td className="py-2 text-right font-medium">
                  {fmtMoney(l.quantite * l.prix_achat, devise)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="py-2 text-right font-bold">
                Total
              </td>
              <td className="py-2 text-right font-bold">{fmtMoney(commande.total, devise)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  );
}
