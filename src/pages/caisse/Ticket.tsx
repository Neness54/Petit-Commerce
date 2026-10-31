import { fmtDateTime, fmtMoney, fmtNum } from "../../lib/format";

export interface TicketLigne {
  nom_produit: string;
  quantite: number;
  prix_unitaire: number;
}

/** Libellé lisible du mode de paiement */
export function libellePaiement(mode: string): string {
  switch (mode) {
    case "carte":
      return "Carte bancaire";
    case "credit":
      return "Crédit";
    default:
      return "Espèces";
  }
}

/** Composant ticket imprimable (papier thermique 80 mm) */
export default function Ticket({
  nomCommerce,
  message,
  numero,
  date,
  lignes,
  montantTotal,
  montantRecu,
  modePaiement,
  clientNom,
  resteAPayer = 0,
  devise,
}: {
  nomCommerce: string;
  message: string;
  numero: string;
  date: string;
  lignes: TicketLigne[];
  montantTotal: number;
  montantRecu: number;
  modePaiement: string;
  clientNom?: string | null;
  resteAPayer?: number;
  devise: string;
}) {
  const especes = modePaiement === "espece";
  const credit = modePaiement === "credit";
  const carte = modePaiement === "carte";

  return (
    <div className="ticket-80mm">
      <div className="centre">
        <div style={{ fontWeight: "bold", fontSize: "14px" }}>{nomCommerce}</div>
        <div>{numero}</div>
        <div>{fmtDateTime(date)}</div>
        {clientNom && <div>Client : {clientNom}</div>}
      </div>
      <div className="pointilles" />
      <table>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              <td>
                {l.nom_produit}
                <br />
                <span style={{ fontSize: "10px" }}>
                  {fmtNum(l.quantite)} × {fmtMoney(l.prix_unitaire, devise)}
                </span>
              </td>
              <td style={{ textAlign: "right" }}>
                {fmtMoney(l.quantite * l.prix_unitaire, devise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pointilles" />
      <table>
        <tbody>
          <tr>
            <td style={{ fontWeight: "bold" }}>TOTAL</td>
            <td style={{ fontWeight: "bold", textAlign: "right" }}>
              {fmtMoney(montantTotal, devise)}
            </td>
          </tr>

          {especes && montantRecu > 0 && (
            <>
              <tr>
                <td>Reçu</td>
                <td style={{ textAlign: "right" }}>{fmtMoney(montantRecu, devise)}</td>
              </tr>
              <tr>
                <td>Rendu</td>
                <td style={{ textAlign: "right" }}>
                  {fmtMoney(Math.max(0, montantRecu - montantTotal), devise)}
                </td>
              </tr>
            </>
          )}

          {carte && (
            <tr>
              <td colSpan={2} style={{ textAlign: "center", fontWeight: "bold" }}>
                PAYÉ PAR CARTE BANCAIRE
              </td>
            </tr>
          )}

          {credit && (
            <>
              <tr>
                <td colSpan={2} style={{ textAlign: "center", fontWeight: "bold" }}>
                  VENTE À CRÉDIT
                </td>
              </tr>
              <tr>
                <td>Reste à payer</td>
                <td style={{ textAlign: "right" }}>{fmtMoney(resteAPayer, devise)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <div className="pointilles" />
      <div className="centre">{message}</div>
    </div>
  );
}
