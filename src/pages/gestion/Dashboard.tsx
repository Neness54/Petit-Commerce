import { useEffect, useState } from "react";
import { q } from "../../lib/db";
import { fmtDateTime, fmtMoney, fmtNum, todayISO } from "../../lib/format";
import { useSettings } from "../../lib/settingsContext";
import type { Mouvement, Produit } from "../../lib/types";

interface Synthese {
  valeur_stock: number;
  nb_produits: number;
  nb_alertes: number;
  nb_ruptures: number;
  ca_jour: number;
  nb_ventes_jour: number;
}

/** Tableau de bord de gestion : alertes, indicateurs, derniers mouvements */
export default function Dashboard({
  onAllerStock,
  onAllerCommandes,
}: {
  onAllerStock: () => void;
  onAllerCommandes: () => void;
}) {
  const { devise } = useSettings();
  const [syn, setSyn] = useState<Synthese | null>(null);
  const [alertes, setAlertes] = useState<Produit[]>([]);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);

  useEffect(() => {
    (async () => {
      const [s] = await q<Synthese>(
        `SELECT
           COALESCE(SUM(stock * prix_achat), 0) AS valeur_stock,
           SUM(CASE WHEN poids IS NULL OR stock > 0 THEN 1 ELSE 0 END) AS nb_produits,
           SUM(CASE WHEN poids IS NULL AND stock > 0 AND stock <= seuil_alerte THEN 1 ELSE 0 END) AS nb_alertes,
           SUM(CASE WHEN poids IS NULL AND stock <= 0 THEN 1 ELSE 0 END) AS nb_ruptures,
           COALESCE((SELECT SUM(montant_total) FROM ventes WHERE annulee = 0 AND date(cree_le) = date('now','localtime')), 0) AS ca_jour,
           COALESCE((SELECT COUNT(*) FROM ventes WHERE annulee = 0 AND date(cree_le) = date('now','localtime')), 0) AS nb_ventes_jour
         FROM produits WHERE actif = 1`,
      );
      setSyn(s ?? null);

      setAlertes(
        await q<Produit>(
          `SELECT * FROM produits WHERE actif = 1 AND poids IS NULL AND stock <= seuil_alerte
           ORDER BY stock ASC LIMIT 10`,
        ),
      );
      setMouvements(
        await q<Mouvement>(
          `SELECT m.*, p.nom AS produit_nom FROM mouvements_stock m
           JOIN produits p ON p.id = m.produit_id
           ORDER BY m.id DESC LIMIT 12`,
        ),
      );
    })();
  }, []);

  const aujourdhui = todayISO();

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Indicateurs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Carte titre="CA du jour" valeur={syn ? fmtMoney(syn.ca_jour, devise) : "…"} couleur="text-green-700" />
        <Carte titre="Ventes du jour" valeur={syn ? String(syn.nb_ventes_jour) : "…"} couleur="text-blue-700" />
        <Carte titre="Valeur du stock" valeur={syn ? fmtMoney(syn.valeur_stock, devise) : "…"} couleur="text-slate-700" />
        <Carte
          titre="Alertes stock"
          valeur={syn ? String(syn.nb_alertes) : "…"}
          couleur="text-orange-600"
        />
        <Carte
          titre="Ruptures"
          valeur={syn ? String(syn.nb_ruptures) : "…"}
          couleur={syn && syn.nb_ruptures > 0 ? "text-red-700" : "text-slate-700"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Alertes */}
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">⚠️ Alertes de stock</h3>
            {alertes.length > 0 && (
              <button
                onClick={onAllerCommandes}
                className="text-sm text-blue-600 hover:underline"
              >
                Créer une commande →
              </button>
            )}
          </div>
          {alertes.length === 0 ? (
            <p className="text-green-700 text-sm">✔ Tous les stocks sont au-dessus des seuils.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {alertes.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2">
                      <button onClick={onAllerStock} className="hover:underline text-left">
                        {p.nom}
                      </button>
                    </td>
                    <td className="py-2 text-right">
                      {p.stock <= 0 ? (
                        <span className="text-red-700 font-semibold">Rupture</span>
                      ) : (
                        <span className="text-orange-600 font-medium">
                          {fmtNum(p.stock)} {p.unite}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right text-slate-400 text-xs">
                      seuil : {fmtNum(p.seuil_alerte)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Derniers mouvements */}
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold mb-3">🕐 Derniers mouvements de stock</h3>
          {mouvements.length === 0 ? (
            <p className="text-slate-400 text-sm">Aucun mouvement enregistré.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              {mouvements.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      m.quantite >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                    }`}
                  >
                    {m.quantite >= 0 ? "+" : ""}
                    {fmtNum(m.quantite)}
                  </span>
                  <span className="flex-1 truncate">{m.produit_nom}</span>
                  <span className="text-xs text-slate-400">{fmtDateTime(m.cree_le)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Carte({
  titre,
  valeur,
  couleur,
}: {
  titre: string;
  valeur: string;
  couleur: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-sm text-slate-500">{titre}</p>
      <p className={`text-2xl font-bold ${couleur}`}>{valeur}</p>
    </div>
  );
}

/** Date du jour (exportée pour réutilisation) */
export const dateDuJour = () => todayISO();
