import { useEffect, useState } from "react";
import { q, exec, tx, type Stmt } from "../../lib/db";
import { fmtDateTime, fmtMoney, fmtNum, todayISO } from "../../lib/format";
import { useSettings } from "../../lib/settingsContext";
import type { LigneVente, Vente } from "../../lib/types";
import { Bouton } from "../../components/Modal";
import ImpressionVente from "./ImpressionVente";

/** Historique des ventes + annulation */
export default function Ventes() {
  const { devise } = useSettings();
  const [date, setDate] = useState(todayISO());
  const [ventes, setVentes] = useState<Vente[]>([]);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [lignes, setLignes] = useState<LigneVente[]>([]);
  const [impression, setImpression] = useState<{
    numero: string;
    doc: "ticket" | "facture";
  } | null>(null);

  const charger = async () => {
    const v = await q<Vente>(
      `SELECT v.*, c.nom AS client_nom
       FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
       WHERE date(v.cree_le) = ?
       ORDER BY v.id DESC`,
      [date],
    );
    setVentes(v);
  };

  useEffect(() => {
    charger();
  }, [date]);

  async function basculerDetails(id: number) {
    if (ouverte === id) {
      setOuverte(null);
      return;
    }
    const l = await q<LigneVente>(
      "SELECT * FROM lignes_vente WHERE vente_id = ? ORDER BY id",
      [id],
    );
    setLignes(l);
    setOuverte(id);
  }

  async function annulerVente(v: Vente) {
    if (v.annulee) return;
    const ok = window.confirm(
      `Annuler la vente ${v.numero} ? Le stock sera recrédité.`,
    );
    if (!ok) return;
    const lv = await q<LigneVente>("SELECT * FROM lignes_vente WHERE vente_id = ?", [v.id]);
    const statements: Stmt[] = [];
    for (const ligne of lv) {
      statements.push({
        sql: "UPDATE produits SET stock = stock + ? WHERE id = ?",
        params: [ligne.quantite, ligne.produit_id],
      });
      statements.push({
        sql: "INSERT INTO mouvements_stock (produit_id, type, quantite, motif, reference) VALUES (?, 'vente_annulee', ?, ?, ?)",
        params: [ligne.produit_id, ligne.quantite, `Annulation vente ${v.numero}`, v.numero],
      });
    }
    statements.push({ sql: "UPDATE ventes SET annulee = 1 WHERE id = ?", params: [v.id] });
    await tx(statements);
    charger();
  }

  const totalJour = ventes
    .filter((v) => !v.annulee)
    .reduce((s, v) => s + v.montant_total, 0);
  const totalCredit = ventes
    .filter((v) => !v.annulee && v.mode_paiement === "credit")
    .reduce((s, v) => s + (v.montant_total - v.montant_paye), 0);

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold">Historique des ventes</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-lg px-3 py-1.5"
        />
        <div className="ml-auto flex gap-4 text-sm">
          <span className="bg-green-50 text-green-800 px-3 py-1.5 rounded-lg font-semibold">
            Encaissé : {fmtMoney(totalJour - totalCredit, devise)}
          </span>
          <span className="bg-orange-50 text-orange-800 px-3 py-1.5 rounded-lg font-semibold">
            Crédit : {fmtMoney(totalCredit, devise)}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-xl border">
        {ventes.length === 0 ? (
          <p className="text-slate-400 text-center mt-10">Aucune vente ce jour.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2">N°</th>
                <th className="text-left px-4 py-2">Heure</th>
                <th className="text-left px-4 py-2">Client</th>
                <th className="text-left px-4 py-2">Paiement</th>
                <th className="text-right px-4 py-2">Montant</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {ventes.map((v) => (
                <>
                  <tr
                    key={v.id}
                    onClick={() => basculerDetails(v.id)}
                    className={`border-t hover:bg-slate-50 cursor-pointer ${v.annulee ? "opacity-50" : ""}`}
                  >
                    <td className="px-4 py-2 font-mono text-xs">{v.numero}</td>
                    <td className="px-4 py-2">{fmtDateTime(v.cree_le).split(" ")[1]}</td>
                    <td className="px-4 py-2">{v.client_nom ?? "—"}</td>
                    <td className="px-4 py-2">
                      {v.mode_paiement === "credit" ? (
                        <span className="text-orange-700">📝 Crédit</span>
                      ) : v.mode_paiement === "carte" ? (
                        <span className="text-blue-700">💳 Carte</span>
                      ) : (
                        <span className="text-green-700">💵 Espèces</span>
                      )}
                      {v.annulee && (
                        <span className="ml-2 text-red-600 font-semibold">ANNULÉE</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {fmtMoney(v.montant_total, devise)}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setImpression({ numero: v.numero, doc: "ticket" });
                        }}
                        className="text-slate-600 hover:underline text-xs"
                        title="Imprimer le ticket de caisse"
                      >
                        🧾 Ticket
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setImpression({ numero: v.numero, doc: "facture" });
                        }}
                        className="text-blue-600 hover:underline text-xs ml-3"
                        title="Imprimer la facture"
                      >
                        📄 Facture
                      </button>
                      {!v.annulee && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            annulerVente(v);
                          }}
                          className="text-red-600 hover:underline text-xs ml-3"
                        >
                          Annuler
                        </button>
                      )}
                    </td>
                  </tr>
                  {ouverte === v.id && (
                    <tr key={`${v.id}-detail`} className="bg-slate-50">
                      <td colSpan={6} className="px-6 py-2">
                        {lignes.map((l) => (
                          <div key={l.id} className="flex text-xs py-0.5 text-slate-600">
                            <span className="flex-1">{l.nom_produit}</span>
                            <span className="w-24 text-right">
                              {fmtNum(l.quantite)} × {fmtMoney(l.prix_unitaire, devise)}
                            </span>
                            <span className="w-24 text-right font-medium">
                              {fmtMoney(l.quantite * l.prix_unitaire, devise)}
                            </span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {impression && (
        <ImpressionVente
          venteNumero={impression.numero}
          documentInitial={impression.doc}
          onFermer={() => setImpression(null)}
        />
      )}
    </div>
  );
}
