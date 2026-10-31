import { useEffect, useState } from "react";
import { q, exec } from "../../lib/db";
import type { Fournisseur } from "../../lib/types";
import Modal, { Bouton, Champ, inputCls } from "../../components/Modal";

/** Fiches fournisseurs */
export default function Fournisseurs() {
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [edit, setEdit] = useState<Fournisseur | "nouveau" | null>(null);
  const [recherche, setRecherche] = useState("");

  const charger = async () => {
    setFournisseurs(
      await q<Fournisseur>(
        `SELECT f.*,
           (SELECT COUNT(*) FROM commandes c WHERE c.fournisseur_id = f.id) AS nb_commandes
         FROM fournisseurs f ORDER BY f.nom COLLATE NOCASE`,
      ),
    );
  };
  useEffect(() => {
    charger();
  }, []);

  const filtres = fournisseurs.filter((f) =>
    f.nom.toLowerCase().includes(recherche.toLowerCase()),
  );

  async function supprimer(f: Fournisseur) {
    const [r] = await q<{ n: number }>(
      "SELECT COUNT(*) AS n FROM commandes WHERE fournisseur_id = ?",
      [f.id],
    );
    if (r && r.n > 0) {
      alert(
        `Impossible de supprimer : ${r.n} commande(s) sont liées à ce fournisseur. Vous pouvez le renommer à la place.`,
      );
      return;
    }
    if (!window.confirm(`Supprimer le fournisseur « ${f.nom} » ?`)) return;
    await exec("DELETE FROM fournisseurs WHERE id = ?", [f.id]);
    charger();
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold">Fournisseurs</h2>
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher…"
          className="border rounded-lg px-3 py-1.5 w-64"
        />
        <div className="ml-auto">
          <Bouton onClick={() => setEdit("nouveau")}>+ Nouveau fournisseur</Bouton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-xl border">
        {filtres.length === 0 ? (
          <p className="text-slate-400 text-center mt-10">Aucun fournisseur.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2">Nom</th>
                <th className="text-left px-4 py-2">Contact</th>
                <th className="text-left px-4 py-2">Téléphone</th>
                <th className="text-left px-4 py-2">E-mail</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtres.map((f) => (
                <tr key={f.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{f.nom}</td>
                  <td className="px-4 py-2">{f.contact ?? "—"}</td>
                  <td className="px-4 py-2">{f.telephone ?? "—"}</td>
                  <td className="px-4 py-2">{f.email ?? "—"}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEdit(f)}
                      className="text-blue-600 hover:underline text-xs mr-3"
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => supprimer(f)}
                      className="text-red-600 hover:underline text-xs"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <FormFournisseur
          fournisseur={edit === "nouveau" ? null : edit}
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

function FormFournisseur({
  fournisseur,
  onFermer,
  onEnregistre,
}: {
  fournisseur: Fournisseur | null;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [nom, setNom] = useState(fournisseur?.nom ?? "");
  const [contact, setContact] = useState(fournisseur?.contact ?? "");
  const [telephone, setTelephone] = useState(fournisseur?.telephone ?? "");
  const [email, setEmail] = useState(fournisseur?.email ?? "");
  const [adresse, setAdresse] = useState(fournisseur?.adresse ?? "");

  async function sauver() {
    if (!nom.trim()) return alert("Le nom est obligatoire.");
    if (fournisseur) {
      await exec(
        "UPDATE fournisseurs SET nom=?, contact=?, telephone=?, email=?, adresse=? WHERE id=?",
        [nom.trim(), contact || null, telephone || null, email || null, adresse || null, fournisseur.id],
      );
    } else {
      await exec(
        "INSERT INTO fournisseurs (nom, contact, telephone, email, adresse) VALUES (?, ?, ?, ?, ?)",
        [nom.trim(), contact || null, telephone || null, email || null, adresse || null],
      );
    }
    onEnregistre();
  }

  return (
    <Modal
      titre={fournisseur ? `Modifier — ${fournisseur.nom}` : "Nouveau fournisseur"}
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
        <Champ label="Nom *">
          <input value={nom} onChange={(e) => setNom(e.target.value)} className={inputCls} autoFocus />
        </Champ>
        <Champ label="Personne de contact">
          <input value={contact} onChange={(e) => setContact(e.target.value)} className={inputCls} />
        </Champ>
        <Champ label="Téléphone">
          <input value={telephone} onChange={(e) => setTelephone(e.target.value)} className={inputCls} />
        </Champ>
        <Champ label="E-mail">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Champ>
        <Champ label="Adresse">
          <input value={adresse} onChange={(e) => setAdresse(e.target.value)} className={inputCls} />
        </Champ>
      </div>
    </Modal>
  );
}
