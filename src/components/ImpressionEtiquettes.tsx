import { useState } from "react";
import { fmtMoney, fmtNum, fmtDateFr } from "../lib/format";
import { useSettings } from "../lib/settingsContext";
import type { Produit } from "../lib/types";
import Modal, { Bouton } from "./Modal";
import CodeBarres from "./CodeBarres";

/** Étiquette code-barres pour un lot (type, poids, date de fabrication) */
function Etiquette({ produit, devise }: { produit: Produit; devise: string }) {
  const poids = produit.poids != null ? `${fmtNum(produit.poids)} kg` : null;

  return (
    <div className="etiquette etiquette-grande">
      <div className="nom">{produit.nom}</div>
      <div className="meta">
        {poids && <span>Poids : {poids}</span>}
        {produit.date_fabrication && <span>Fabriqué le : {fmtDateFr(produit.date_fabrication)}</span>}
      </div>
      <div className="prix">{fmtMoney(produit.prix_vente, devise)}</div>
      {produit.code_barres ? (
        <CodeBarres valeur={produit.code_barres} largeur={1.4} hauteur={22} />
      ) : (
        <div style={{ fontSize: "7pt" }}>PAS DE CODE-BARRES</div>
      )}
    </div>
  );
}

/** Impression d'étiquettes code-barres */
export default function ImpressionEtiquettes({
  produits,
  quantiteInitiale = 1,
  onFermer,
}: {
  produits: Produit[];
  quantiteInitiale?: number;
  onFermer: () => void;
}) {
  const [quantites, setQuantites] = useState<Record<number, number>>(
    Object.fromEntries(produits.map((p) => [p.id, Math.max(1, Math.floor(quantiteInitiale))])),
  );
  const { devise } = useSettings();
  const [imprimer, setImprimer] = useState(false);

  const total = produits.reduce((s, p) => s + (quantites[p.id] ?? 0), 0);
  const sansCode = produits.filter((p) => !p.code_barres);

  const etiquettes: Produit[] = [];
  for (const p of produits) {
    for (let i = 0; i < (quantites[p.id] ?? 0); i++) etiquettes.push(p);
  }

  return (
    <Modal
      titre="Imprimer des étiquettes"
      onFermer={onFermer}
      large
      pied={
        <>
          <Bouton variante="secondaire" onClick={onFermer}>
            Fermer
          </Bouton>
          <Bouton
            variante="primaire"
            onClick={() => {
              setImprimer(true);
              setTimeout(() => {
                window.print();
                onFermer();
              }, 250);
            }}
            disabled={total === 0}
          >
            🖨 Imprimer {total} étiquette{total > 1 ? "s" : ""}
          </Bouton>
        </>
      }
    >
      {sansCode.length > 0 && (
        <p className="text-orange-700 bg-orange-50 rounded-lg px-3 py-2 text-sm mb-3">
          ⚠️ {sansCode.length} produit(s) sans code-barres : {sansCode.map((p) => p.nom).join(", ")}.
          Générez un code dans la fiche produit.
        </p>
      )}
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {produits.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border rounded-lg px-3 py-2">
            <span className="flex-1 text-sm font-medium">{p.nom}</span>
            <button
              onClick={() =>
                setQuantites((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))
              }
              className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 font-bold"
            >
              −
            </button>
            <span className="w-8 text-center font-semibold">{quantites[p.id] ?? 0}</span>
            <button
              onClick={() => setQuantites((q) => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }))}
              className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 font-bold"
            >
              +
            </button>
          </div>
        ))}
      </div>

      {imprimer && (
        <div id="print-area">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2mm" }}>
            {etiquettes.map((p, i) => (
              <Etiquette key={i} produit={p} devise={devise} />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
