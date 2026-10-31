import { useEffect, useState } from "react";
import { q } from "../../lib/db";
import { useSettings } from "../../lib/settingsContext";
import { Bouton } from "../../components/Modal";
import Ticket, { type TicketLigne } from "./Ticket";
import Facture, { type FactureEntreprise } from "./Facture";

interface VenteComplete {
  numero: string;
  montant_total: number;
  montant_paye: number;
  montant_recu: number | null;
  mode_paiement: string;
  cree_le: string;
  client_id: number | null;
  client_nom: string | null;
  client_telephone: string | null;
  client_email: string | null;
  client_adresse: string | null;
}

type Doc = "ticket" | "facture";

/**
 * Fenêtre d'impression d'une vente : ticket de caisse 80 mm ou facture A4
 * avec les coordonnées du client. Réutilisée après l'encaissement et depuis
 * l'historique des ventes.
 */
export default function ImpressionVente({
  venteNumero,
  onFermer,
  documentInitial,
}: {
  venteNumero: string;
  onFermer: () => void;
  documentInitial?: Doc;
}) {
  const { devise, nomCommerce, get } = useSettings();
  const [vente, setVente] = useState<VenteComplete | null>(null);
  const [lignes, setLignes] = useState<TicketLigne[]>([]);
  const [doc, setDoc] = useState<Doc>(documentInitial ?? "ticket");
  const [impression, setImpression] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [entreprise, setEntreprise] = useState<FactureEntreprise | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const v = await q<VenteComplete>(
          `SELECT v.numero, v.montant_total, v.montant_paye, v.montant_recu,
                  v.mode_paiement, v.cree_le, v.client_id,
                  c.nom AS client_nom, c.telephone AS client_telephone,
                  c.email AS client_email, c.adresse AS client_adresse
             FROM ventes v
             LEFT JOIN clients c ON c.id = v.client_id
            WHERE v.numero = ?`,
          [venteNumero],
        );
        const l = await q<TicketLigne>(
          `SELECT lv.nom_produit, lv.quantite, lv.prix_unitaire
             FROM lignes_vente lv JOIN ventes v ON v.id = lv.vente_id
            WHERE v.numero = ?
            ORDER BY lv.id`,
          [venteNumero],
        );
        const ent = await q<{ cle: string; valeur: string }>(
          "SELECT cle, valeur FROM parametres WHERE cle LIKE 'entreprise_%'",
        );
        const emap = Object.fromEntries(ent.map((r) => [r.cle, r.valeur]));
        if (annule) return;
        if (!v[0]) {
          setErreur("Vente introuvable.");
          return;
        }
        setVente(v[0]);
        setLignes(l);
        setEntreprise({
          nom: emap.entreprise_nom || null,
          adresse: emap.entreprise_adresse || null,
          telephone: emap.entreprise_telephone || null,
          email: emap.entreprise_email || null,
          siret: emap.entreprise_siret || null,
          logo: emap.entreprise_logo || null,
        });
      } catch (e) {
        if (!annule) setErreur(`Chargement impossible : ${e}`);
      }
    })();
    return () => {
      annule = true;
    };
  }, [venteNumero]);

  useEffect(() => {
    if (!impression) return;
    const t = setTimeout(() => {
      window.print();
      setImpression(false);
    }, 250);
    return () => clearTimeout(t);
  }, [impression]);

  const message = get("message_ticket", "Merci de votre visite !");
  const client = vente
    ? {
        nom: vente.client_nom,
        telephone: vente.client_telephone,
        email: vente.client_email,
        adresse: vente.client_adresse,
      }
    : null;

  const corps = vente && (
    <>
      {doc === "ticket" ? (
        <Ticket
          nomCommerce={nomCommerce}
          message={message}
          numero={vente.numero}
          date={vente.cree_le}
          lignes={lignes}
          montantTotal={vente.montant_total}
          montantRecu={vente.montant_recu ?? (vente.mode_paiement === "espece" ? vente.montant_paye : 0)}
          modePaiement={vente.mode_paiement}
          clientNom={vente.client_nom}
          resteAPayer={Math.max(0, vente.montant_total - vente.montant_paye)}
          devise={devise}
        />
      ) : (
        <Facture
          nomCommerce={nomCommerce}
          message={message}
          numero={vente.numero}
          date={vente.cree_le}
          lignes={lignes}
          montantTotal={vente.montant_total}
          montantPaye={vente.montant_paye}
          modePaiement={vente.mode_paiement}
          client={client}
          entreprise={entreprise}
          devise={devise}
        />
      )}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col">
        <div className="p-5 border-b space-y-1">
          <p className="font-semibold text-center">
            Vente {venteNumero} enregistrée ✔
          </p>
          <p className="text-sm text-slate-500 text-center">
            Choisissez le document à remettre au client.
          </p>
        </div>

        <div className="px-5 py-3 border-b flex gap-2">
          <button
            onClick={() => setDoc("ticket")}
            className={`flex-1 py-2 rounded-lg border-2 font-medium ${
              doc === "ticket"
                ? "border-green-600 bg-green-50 text-green-800"
                : "border-slate-200 text-slate-500"
            }`}
          >
            🧾 Ticket de caisse
          </button>
          <button
            onClick={() => setDoc("facture")}
            className={`flex-1 py-2 rounded-lg border-2 font-medium ${
              doc === "facture"
                ? "border-blue-600 bg-blue-50 text-blue-800"
                : "border-slate-200 text-slate-500"
            }`}
          >
            📄 Facture {vente?.client_nom ? `— ${vente.client_nom}` : ""}
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 bg-slate-100">
          {erreur ? (
            <p className="text-red-700 bg-red-50 rounded-lg px-3 py-2 text-sm">{erreur}</p>
          ) : !vente ? (
            <p className="text-slate-400 text-center py-6">Chargement…</p>
          ) : (
            <div className="bg-white shadow rounded p-4 mx-auto w-fit max-w-full overflow-x-auto">
              {corps}
            </div>
          )}
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <Bouton variante="secondaire" onClick={onFermer}>
            Fermer
          </Bouton>
          <Bouton
            variante="primaire"
            onClick={() => setImpression(true)}
            disabled={!vente || impression}
          >
            🖨 Imprimer {doc === "ticket" ? "le ticket" : "la facture"}
          </Bouton>
        </div>

        {impression && vente && <div id="print-area">{corps}</div>}
      </div>
    </div>
  );
}
