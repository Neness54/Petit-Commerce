import { useEffect, useState } from "react";
import { q, exec } from "../../lib/db";
import { fmtMoney, fmtNum, saveCSV, todayISO } from "../../lib/export";
import { useSettings } from "../../lib/settingsContext";

interface LigneTop {
  nom: string;
  quantite: number;
  ca: number;
  marge: number;
}

interface LigneJour {
  jour: string;
  ca: number;
  nb: number;
}

/** Statistiques de vente : CA, top produits, tendance */
export default function StatsVentes() {
  const { devise, nomCommerce } = useSettings();
  const [debut, setDebut] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });
  const [fin, setFin] = useState(todayISO());
  const [top, setTop] = useState<LigneTop[]>([]);
  const [parJour, setParJour] = useState<LigneJour[]>([]);
  const [synthese, setSynthese] = useState({ ca: 0, nb: 0, marge: 0, credit: 0 });

  useEffect(() => {
    (async () => {
      const t = await q<LigneTop>(
        `SELECT lv.nom_produit AS nom,
                SUM(lv.quantite) AS quantite,
                SUM(lv.quantite * lv.prix_unitaire) AS ca,
                SUM(lv.quantite * (lv.prix_unitaire - lv.prix_achat)) AS marge
         FROM lignes_vente lv
         JOIN ventes v ON v.id = lv.vente_id
         WHERE v.annulee = 0 AND date(v.cree_le) BETWEEN ? AND ?
         GROUP BY lv.nom_produit
         ORDER BY ca DESC
         LIMIT 15`,
        [debut, fin],
      );
      setTop(t);

      const j = await q<LigneJour>(
        `SELECT date(cree_le) AS jour, SUM(montant_total) AS ca, COUNT(*) AS nb
         FROM ventes
         WHERE annulee = 0 AND date(cree_le) BETWEEN ? AND ?
         GROUP BY date(cree_le)
         ORDER BY jour`,
        [debut, fin],
      );
      setParJour(j);

      const [s] = await q<{ ca: number; nb: number; marge: number; credit: number }>(
        `SELECT
           COALESCE(SUM(v.montant_total), 0) AS ca,
           COUNT(*) AS nb,
           COALESCE((SELECT SUM(lv.quantite * (lv.prix_unitaire - lv.prix_achat))
                     FROM lignes_vente lv JOIN ventes v2 ON v2.id = lv.vente_id
                     WHERE v2.annulee = 0 AND date(v2.cree_le) BETWEEN ? AND ?), 0) AS marge,
           COALESCE(SUM(v.montant_total - v.montant_paye), 0) AS credit
         FROM ventes v
         WHERE v.annulee = 0 AND date(v.cree_le) BETWEEN ? AND ?`,
        [debut, fin, debut, fin],
      );
      setSynthese(s ?? { ca: 0, nb: 0, marge: 0, credit: 0 });
    })();
  }, [debut, fin]);

  const maxJour = Math.max(...parJour.map((j) => j.ca), 1);
  const panierMoyen = synthese.nb > 0 ? synthese.ca / synthese.nb : 0;

  async function exporter() {
    await saveCSV(
      `ventes_${debut}_${fin}.csv`,
      ["Produit", "Quantité vendue", "Chiffre d'affaires", "Marge"],
      top.map((t) => [t.nom, t.quantite, t.ca, t.marge]),
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold">Statistiques de vente</h2>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span>Du</span>
          <input
            type="date"
            value={debut}
            onChange={(e) => setDebut(e.target.value)}
            className="border rounded-lg px-2 py-1.5"
          />
          <span>au</span>
          <input
            type="date"
            value={fin}
            onChange={(e) => setFin(e.target.value)}
            className="border rounded-lg px-2 py-1.5"
          />
          <button
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 29);
              setDebut(d.toISOString().slice(0, 10));
              setFin(todayISO());
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300"
          >
            30 derniers jours
          </button>
        </div>
      </div>

      {/* Cartes de synthèse */}
      <div className="grid grid-cols-4 gap-4">
        <Carte titre="Chiffre d'affaires" valeur={fmtMoney(synthese.ca, devise)} couleur="text-green-700" />
        <Carte titre="Ventes" valeur={String(synthese.nb)} couleur="text-blue-700" />
        <Carte titre="Panier moyen" valeur={fmtMoney(panierMoyen, devise)} couleur="text-slate-700" />
        <Carte titre="Encore à crédit" valeur={fmtMoney(synthese.credit, devise)} couleur="text-orange-700" />
      </div>

      {/* Graphique par jour */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold mb-3">Chiffre d'affaires par jour</h3>
        {parJour.length === 0 ? (
          <p className="text-slate-400 text-sm">Aucune vente sur la période.</p>
        ) : (
          <div className="flex items-end gap-1 h-40">
            {parJour.map((j) => (
              <div key={j.jour} className="flex-1 flex flex-col items-center group">
                <div
                  className="w-full bg-green-500 rounded-t group-hover:bg-green-600"
                  style={{ height: `${Math.max(2, (j.ca / maxJour) * 100)}%` }}
                  title={`${j.jour} : ${fmtMoney(j.ca, devise)} (${j.nb} ventes)`}
                />
              </div>
            ))}
          </div>
        )}
        {parJour.length > 0 && (
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>{parJour[0].jour}</span>
            <span>{parJour[parJour.length - 1].jour}</span>
          </div>
        )}
      </div>

      {/* Top produits */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Produits les plus vendus</h3>
          <button onClick={exporter} className="text-sm text-blue-600 hover:underline">
            ⬇ Exporter en CSV
          </button>
        </div>
        {top.length === 0 ? (
          <p className="text-slate-400 text-sm">Aucune donnée.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-500 border-b">
              <tr>
                <th className="text-left py-2">Produit</th>
                <th className="text-right py-2">Quantité</th>
                <th className="text-right py-2">CA</th>
                <th className="text-right py-2">Marge</th>
              </tr>
            </thead>
            <tbody>
              {top.map((t) => (
                <tr key={t.nom} className="border-b last:border-0">
                  <td className="py-2">{t.nom}</td>
                  <td className="py-2 text-right">{fmtNum(t.quantite)}</td>
                  <td className="py-2 text-right font-medium">{fmtMoney(t.ca, devise)}</td>
                  <td className="py-2 text-right text-green-700">{fmtMoney(t.marge, devise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Carte({ titre, valeur, couleur }: { titre: string; valeur: string; couleur: string }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-sm text-slate-500">{titre}</p>
      <p className={`text-2xl font-bold ${couleur}`}>{valeur}</p>
    </div>
  );
}
