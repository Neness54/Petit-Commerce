import { fmtDateTime, fmtMoney, fmtNum } from "../../lib/format";
import type { TicketLigne } from "./Ticket";
import { libellePaiement } from "./Ticket";

export interface FactureClient {
  nom: string | null;
  telephone?: string | null;
  email?: string | null;
  adresse?: string | null;
}

export interface FactureEntreprise {
  nom?: string | null;
  adresse?: string | null;
  telephone?: string | null;
  email?: string | null;
  siret?: string | null;
  logo?: string | null;
}

/** Facture A4 imprimable, avec les coordonnées du client */
export default function Facture({
  nomCommerce,
  message,
  numero,
  date,
  lignes,
  montantTotal,
  montantPaye,
  modePaiement,
  client,
  entreprise,
  devise,
}: {
  nomCommerce: string;
  message: string;
  numero: string;
  date: string;
  lignes: TicketLigne[];
  montantTotal: number;
  montantPaye: number;
  modePaiement: string;
  client: FactureClient | null;
  entreprise?: FactureEntreprise | null;
  devise: string;
}) {
  const reste = Math.max(0, montantTotal - montantPaye);
  const credit = modePaiement === "credit";
  const entNom = entreprise?.nom || nomCommerce;
  const entAdr = entreprise?.adresse;
  const entTel = entreprise?.telephone;
  const entMail = entreprise?.email;
  const entSiret = entreprise?.siret;
  const entLogo = entreprise?.logo;

  return (
    <div className="facture-a4">
      {/* En-tête */}
      <div className="facture-entete">
        <div className="facture-entete-gauche">
          {entLogo && (
            <img src={entLogo} alt="Logo" className="facture-logo" />
          )}
          <div>
            <div className="facture-commerce">{entNom}</div>
            {entAdr && <div className="facture-entreprise-adresse pre">{entAdr}</div>}
            <div className="facture-entreprise-contact">
              {entTel && <span>Tél. : {entTel}</span>}
              {entMail && <span>E-mail : {entMail}</span>}
              {entSiret && <span>{entSiret}</span>}
            </div>
          </div>
        </div>
        <div className="facture-meta">
          <div>
            <span>N° </span>
            <b>{numero}</b>
          </div>
          <div>{fmtDateTime(date)}</div>
          <div>Règlement : {libellePaiement(modePaiement)}</div>
        </div>
      </div>

      {/* Client */}
      <div className="facture-client">
        <div className="facture-client-titre">Facturé à</div>
        <div className="facture-client-nom">{client?.nom || "Client comptant"}</div>
        {client?.adresse && <div className="pre">{client.adresse}</div>}
        {client?.telephone && <div>Tél. : {client.telephone}</div>}
        {client?.email && <div>E-mail : {client.email}</div>}
      </div>

      {/* Lignes */}
      <table className="facture-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Désignation</th>
            <th style={{ textAlign: "right", width: "18mm" }}>Qté</th>
            <th style={{ textAlign: "right", width: "30mm" }}>Prix unitaire</th>
            <th style={{ textAlign: "right", width: "32mm" }}>Montant</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              <td>{l.nom_produit}</td>
              <td style={{ textAlign: "right" }}>{fmtNum(l.quantite)}</td>
              <td style={{ textAlign: "right" }}>{fmtMoney(l.prix_unitaire, devise)}</td>
              <td style={{ textAlign: "right" }}>{fmtMoney(l.quantite * l.prix_unitaire, devise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totaux */}
      <div className="facture-totaux">
        <table>
          <tbody>
            <tr>
              <td>Total</td>
              <td className="montant">{fmtMoney(montantTotal, devise)}</td>
            </tr>
            <tr>
              <td>Payé ({libellePaiement(modePaiement).toLowerCase()})</td>
              <td className="montant">{fmtMoney(montantPaye, devise)}</td>
            </tr>
            {credit && (
              <tr className={reste > 0 ? "reste" : ""}>
                <td>
                  <b>Reste à payer</b>
                </td>
                <td className="montant">
                  <b>{fmtMoney(reste, devise)}</b>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {credit && reste > 0 && (
        <p className="facture-note">
          Montant restant dû : {fmtMoney(reste, devise)}. Merci de régler ce solde auprès du
          commerce.
        </p>
      )}

      <div className="facture-pied">
        <div>{message}</div>
        <div>
          {entSiret && <span>{entSiret} · </span>}
          {entNom} — Facture générée le {fmtDateTime(new Date().toISOString())}
        </div>
      </div>
    </div>
  );
}
