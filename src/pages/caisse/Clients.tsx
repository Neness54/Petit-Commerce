import { useEffect, useState } from "react";
import { q, exec, tx, CLIENTS_AVEC_DETTE } from "../../lib/db";
import { fmtDateTime, fmtMoney } from "../../lib/format";
import { useSettings } from "../../lib/settingsContext";
import type { Client, Paiement, Vente } from "../../lib/types";
import Modal, { Bouton, Champ, inputCls } from "../../components/Modal";

/** Clients : fiches, dettes, remboursements */
export default function Clients() {
  const { devise } = useSettings();
  const [clients, setClients] = useState<Client[]>([]);
  const [recherche, setRecherche] = useState("");
  const [edit, setEdit] = useState<Client | "nouveau" | null>(null);
  const [fiche, setFiche] = useState<Client | null>(null);

  const charger = async () => {
    setClients(await q<Client>(CLIENTS_AVEC_DETTE));
  };
  useEffect(() => {
    charger();
  }, []);

  const filtres = clients.filter((c) =>
    c.nom.toLowerCase().includes(recherche.toLowerCase()) ||
    (c.telephone ?? "").includes(recherche),
  );

  const totalDettes = clients.reduce((s, c) => s + (c.dette ?? 0), 0);

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold">Clients</h2>
        <span className="text-sm text-slate-500">
          Dettes totales : <b className="text-orange-700">{fmtMoney(totalDettes, devise)}</b>
        </span>
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un client…"
          className="ml-4 border rounded-lg px-3 py-1.5 w-64"
        />
        <div className="ml-auto">
          <Bouton onClick={() => setEdit("nouveau")}>+ Nouveau client</Bouton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-xl border">
        {filtres.length === 0 ? (
          <p className="text-slate-400 text-center mt-10">Aucun client.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2">Nom</th>
                <th className="text-left px-4 py-2">Téléphone</th>
                <th className="text-right px-4 py-2">Plafond crédit</th>
                <th className="text-right px-4 py-2">Dette</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtres.map((c) => (
                <tr key={c.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <button
                      onClick={() => setFiche(c)}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {c.nom}
                    </button>
                  </td>
                  <td className="px-4 py-2">{c.telephone ?? "—"}</td>
                  <td className="px-4 py-2 text-right text-slate-500">
                    {c.plafond_credit > 0 ? fmtMoney(c.plafond_credit, devise) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span
                      className={`font-semibold ${(c.dette ?? 0) > 0 ? "text-orange-700" : "text-green-700"}`}
                    >
                      {fmtMoney(c.dette ?? 0, devise)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setEdit(c)}
                      className="text-blue-600 hover:underline text-xs mr-3"
                    >
                      Modifier
                    </button>
                    {(c.dette ?? 0) > 0 && (
                      <button
                        onClick={() => setFiche(c)}
                        className="text-green-600 hover:underline text-xs"
                      >
                        Rembourser
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <FormClient
          client={edit === "nouveau" ? null : edit}
          onFermer={() => setEdit(null)}
          onEnregistre={() => {
            setEdit(null);
            charger();
          }}
        />
      )}
      {fiche && (
        <FicheClient
          client={fiche}
          onFermer={() => {
            setFiche(null);
            charger();
          }}
        />
      )}
    </div>
  );
}

/** Ajout / modification d'un client */
function FormClient({
  client,
  onFermer,
  onEnregistre,
}: {
  client: Client | null;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [nom, setNom] = useState(client?.nom ?? "");
  const [telephone, setTelephone] = useState(client?.telephone ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [adresse, setAdresse] = useState(client?.adresse ?? "");
  const [plafond, setPlafond] = useState(String(client?.plafond_credit ?? 0).replace(".", ","));
  const [erreur, setErreur] = useState<string | null>(null);

  async function sauver() {
    if (!nom.trim()) return setErreur("Le nom est obligatoire.");
    const p = parseFloat(plafond.replace(",", ".")) || 0;
    if (client) {
      await exec(
        "UPDATE clients SET nom = ?, telephone = ?, email = ?, adresse = ?, plafond_credit = ? WHERE id = ?",
        [nom.trim(), telephone || null, email || null, adresse || null, p, client.id],
      );
    } else {
      await exec(
        "INSERT INTO clients (nom, telephone, email, adresse, plafond_credit) VALUES (?, ?, ?, ?, ?)",
        [nom.trim(), telephone || null, email || null, adresse || null, p],
      );
    }
    onEnregistre();
  }

  return (
    <Modal
      titre={client ? `Modifier ${client.nom}` : "Nouveau client"}
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
        <Champ label="Nom *">
          <input value={nom} onChange={(e) => setNom(e.target.value)} className={inputCls} autoFocus />
        </Champ>
        <Champ label="Téléphone">
          <input value={telephone} onChange={(e) => setTelephone(e.target.value)} className={inputCls} />
        </Champ>
        <Champ label="E-mail">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Champ>
        <Champ label="Adresse (facture)">
          <textarea
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </Champ>
        <Champ label="Plafond de crédit (0 = aucun crédit)">
          <input
            value={plafond}
            onChange={(e) => setPlafond(e.target.value)}
            inputMode="decimal"
            className={inputCls}
          />
        </Champ>
      </div>
    </Modal>
  );
}

/** Fiche client : historique des ventes + encaissement d'un remboursement */
function FicheClient({ client, onFermer }: { client: Client; onFermer: () => void }) {
  const { devise } = useSettings();
  const [ventes, setVentes] = useState<Vente[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [montant, setMontant] = useState("");

  const charger = async () => {
    setVentes(
      await q<Vente>(
        `SELECT * FROM ventes WHERE client_id = ? AND annulee = 0 AND mode_paiement = 'credit'
         ORDER BY id DESC LIMIT 50`,
        [client.id],
      ),
    );
    setPaiements(
      await q<Paiement>("SELECT * FROM paiements WHERE client_id = ? ORDER BY id DESC LIMIT 50", [
        client.id,
      ]),
    );
  };
  useEffect(() => {
    charger();
  }, [client.id]);

  const dette = Math.max(
    0,
    ventes.reduce((s, v) => s + (v.montant_total - v.montant_paye), 0) -
      paiements.reduce((s, p) => s + p.montant, 0),
  );

  async function rembourser() {
    const m = parseFloat(montant.replace(",", "."));
    if (!m || m <= 0) return alert("Montant invalide.");
    if (m > dette + 0.001) return alert("Le remboursement dépasse la dette.");
    await exec("INSERT INTO paiements (client_id, montant, motif) VALUES (?, ?, 'remboursement')", [
      client.id,
      m,
    ]);
    setMontant("");
    charger();
  }

  return (
    <Modal titre={`Fiche client — ${client.nom}`} onFermer={onFermer} large>
      <div className="grid grid-cols-2 gap-6">
        {/* Colonne gauche : dettes et remboursements */}
        <div className="space-y-4">
          {(client.telephone || client.email || client.adresse) && (
            <div className="text-sm text-slate-600 space-y-0.5">
              {client.telephone && <p>📞 {client.telephone}</p>}
              {client.email && <p>✉️ {client.email}</p>}
              {client.adresse && <p className="whitespace-pre-line">📍 {client.adresse}</p>}
            </div>
          )}

          <div className={`rounded-xl p-4 ${dette > 0 ? "bg-orange-50" : "bg-green-50"}`}>
            <p className="text-sm text-slate-600">Dette actuelle</p>
            <p className={`text-3xl font-bold ${dette > 0 ? "text-orange-700" : "text-green-700"}`}>
              {fmtMoney(dette, devise)}
            </p>
            {client.plafond_credit > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Plafond autorisé : {fmtMoney(client.plafond_credit, devise)}
              </p>
            )}
          </div>

          {dette > 0 && (
            <div className="flex gap-2">
              <input
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
                placeholder="Montant reçu"
                inputMode="decimal"
                className={inputCls}
              />
              <Bouton variante="succes" onClick={rembourser}>
                💶 Rembourser
              </Bouton>
            </div>
          )}

          <div>
            <h3 className="font-semibold text-sm text-slate-600 mb-2">Remboursements</h3>
            {paiements.length === 0 ? (
              <p className="text-xs text-slate-400">Aucun.</p>
            ) : (
              paiements.map((p) => (
                <div key={p.id} className="flex justify-between text-sm py-1 border-b">
                  <span className="text-slate-500">{fmtDateTime(p.cree_le)}</span>
                  <span className="font-medium text-green-700">+{fmtMoney(p.montant, devise)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Colonne droite : ventes à crédit */}
        <div>
          <h3 className="font-semibold text-sm text-slate-600 mb-2">Ventes à crédit</h3>
          {ventes.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune vente à crédit.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {ventes.map((v) => (
                  <tr key={v.id} className="border-b">
                    <td className="py-1.5 font-mono text-xs">{v.numero}</td>
                    <td className="py-1.5 text-slate-500">{fmtDateTime(v.cree_le)}</td>
                    <td className="py-1.5 text-right font-semibold">
                      {fmtMoney(v.montant_total, devise)}
                    </td>
                    <td className="py-1.5 text-right">
                      {v.montant_paye > 0 && (
                        <span className="text-xs text-green-700">
                          payé {fmtMoney(v.montant_paye, devise)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
