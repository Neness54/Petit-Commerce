import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save, message as dlgMessage } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { closeDb, exec, q } from "../../lib/db";
import { sha256Hex } from "../../lib/sha256";
import { useSettings } from "../../lib/settingsContext";
import { Bouton, Champ, inputCls } from "../../components/Modal";

const DEVISES = [
  ["EUR", "Euro (€)"],
  ["USD", "Dollar ($)"],
  ["XOF", "Franc CFA (XOF)"],
  ["XAF", "Franc CFA (XAF)"],
  ["MAD", "Dirham (DH)"],
  ["GBP", "Livre (£)"],
  ["CHF", "Franc suisse (CHF)"],
  ["CAD", "Dollar canadien ($)"],
  ["GNF", "Franc guinéen (GNF)"],
  ["CDF", "Franc congolais (FC)"],
  ["HTG", "Gourde (G)"],
] as const;

/** Paramètres : infos du commerce, devise, PIN, sauvegarde */
export default function Parametres() {
  const { reload, get } = useSettings();
  const [nom, setNom] = useState("");
  const [devise, setDevise] = useState("EUR");
  const [messageTicket, setMessageTicket] = useState("");
  const [pin, setPin] = useState("");
  const [pinActif, setPinActif] = useState(false);
  const [dbPath, setDbPath] = useState("");
  const [sauvegardeEnCours, setSauvegardeEnCours] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  // Infos entreprise / facture
  const [entNom, setEntNom] = useState("");
  const [entAdr, setEntAdr] = useState("");
  const [entTel, setEntTel] = useState("");
  const [entMail, setEntMail] = useState("");
  const [entSiret, setEntSiret] = useState("");
  const [entLogo, setEntLogo] = useState("");

  useEffect(() => {
    setNom(get("nom_commerce", "Mon Commerce"));
    setDevise(get("devise", "EUR"));
    setMessageTicket(get("message_ticket", "Merci de votre visite !"));
    setPinActif(!!get("pin_caisse"));
    invoke<string>("database_path").then(setDbPath).catch(() => {});
    (async () => {
      const rows = await q<{ cle: string; valeur: string }>(
        "SELECT cle, valeur FROM parametres WHERE cle LIKE 'entreprise_%'",
      );
      const map = Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
      setEntNom(map.entreprise_nom ?? "");
      setEntAdr(map.entreprise_adresse ?? "");
      setEntTel(map.entreprise_telephone ?? "");
      setEntMail(map.entreprise_email ?? "");
      setEntSiret(map.entreprise_siret ?? "");
      setEntLogo(map.entreprise_logo ?? "");
    })();
  }, [get]);

  async function enregistrerEntreprise() {
    const upsert = async (cle: string, valeur: string) => {
      await exec(
        `INSERT INTO parametres (cle, valeur) VALUES (?, ?)
         ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
        [cle, valeur],
      );
    };
    await upsert("entreprise_nom", entNom.trim());
    await upsert("entreprise_adresse", entAdr.trim());
    await upsert("entreprise_telephone", entTel.trim());
    await upsert("entreprise_email", entMail.trim());
    await upsert("entreprise_siret", entSiret.trim());
    await upsert("entreprise_logo", entLogo);
    await reload();
    setInfo("Informations entreprise enregistrées ✔");
  }

  async function choisirLogo() {
    try {
      const path = await open({
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
        multiple: false,
      });
      if (!path || Array.isArray(path)) return;
      const data = await readFile(path);
      const ext = path.split(".").pop()?.toLowerCase() || "png";
      const mime =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "webp"
            ? "image/webp"
            : ext === "svg"
              ? "image/svg+xml"
              : "image/png";
      let bin = "";
      const bytes = data as Uint8Array;
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      setEntLogo(`data:${mime};base64,${b64}`);
    } catch (e) {
      setInfo(`Erreur logo : ${e}`);
    }
  }

  async function retirerLogo() {
    setEntLogo("");
  }

  async function enregistrerInfos() {
    await exec(
      `INSERT INTO parametres (cle, valeur) VALUES ('nom_commerce', ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [nom.trim() || "Mon Commerce"],
    );
    await exec(
      `INSERT INTO parametres (cle, valeur) VALUES ('devise', ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [devise],
    );
    await exec(
      `INSERT INTO parametres (cle, valeur) VALUES ('message_ticket', ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [messageTicket],
    );
    await reload();
    setInfo("Paramètres enregistrés ✔");
  }

  async function changerPin() {
    if (pin.length < 4) {
      setInfo("⚠️ Le PIN doit contenir au moins 4 chiffres.");
      return;
    }
    const hash = await sha256Hex("pc-pin:" + pin);
    await exec(
      `INSERT INTO parametres (cle, valeur) VALUES ('pin_caisse', ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [hash],
    );
    setPin("");
    setPinActif(true);
    await reload();
    setInfo("PIN de caisse défini ✔");
  }

  async function retirerPin() {
    if (!window.confirm("Retirer la protection PIN du mode caisse ?")) return;
    await exec(
      `INSERT INTO parametres (cle, valeur) VALUES ('pin_caisse', '')
       ON CONFLICT(cle) DO UPDATE SET valeur = ''`,
    );
    setPinActif(false);
    await reload();
    setInfo("PIN retiré.");
  }

  /** Sauvegarde : VACUUM INTO crée une copie cohérente même avec l'app ouverte */
  async function sauvegarder() {
    setSauvegardeEnCours(true);
    try {
      const path = await save({
        defaultPath: `sauvegarde-petit-commerce-${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: "Base de données SQLite", extensions: ["db"] }],
      });
      if (!path) return;
      await exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
      await dlgMessage("Sauvegarde terminée avec succès.", "Sauvegarde ✔");
    } catch (e) {
      await dlgMessage(`Échec de la sauvegarde : ${e}`, "Erreur");
    } finally {
      setSauvegardeEnCours(false);
    }
  }

  /** Restauration : remplace la base puis redémarre l'application */
  async function restaurer() {
    const ok = window.confirm(
      "⚠️ La restauration remplacera TOUTES les données actuelles par la sauvegarde choisie.\n\nContinuer ?",
    );
    if (!ok) return;
    const path = await open({
      filters: [{ name: "Base de données SQLite", extensions: ["db"] }],
      multiple: false,
    });
    if (!path || Array.isArray(path)) return;
    try {
      await closeDb(); // fermer la connexion avant de remplacer le fichier
      await invoke("restore_database", { src: path });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      await dlgMessage(`Échec de la restauration : ${e}`, "Erreur");
    }
  }

  async function viderHistorique() {
    const ok = window.confirm(
      "⚠️ Supprimer TOUT l'historique des ventes et remettre les stocks au niveau déclaré dans les fiches ?\n\nCette action est irréversible (une sauvegarde est recommandée).",
    );
    if (!ok) return;
    await exec("DELETE FROM lignes_vente");
    await exec("DELETE FROM ventes");
    await exec("DELETE FROM paiements");
    await exec("DELETE FROM mouvements_stock");
    setInfo("Historique vidé.");
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <h2 className="text-xl font-bold">Paramètres</h2>
        {info && (
          <p className="text-sm bg-blue-50 text-blue-800 border border-blue-200 rounded-lg px-3 py-2">
            {info}
          </p>
        )}

        {/* Infos entreprise pour factures */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-semibold">📄 Coordonnées entreprise (factures)</h3>
          <p className="text-sm text-slate-500">
            Ces informations apparaîtront en en-tête de vos factures A4 avec le logo.
          </p>
          <div className="flex gap-4 items-start">
            <div className="w-28 h-28 border rounded-lg flex items-center justify-center bg-slate-50 overflow-hidden">
              {entLogo ? (
                <img src={entLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-slate-400 text-xs text-center px-2">Aucun logo</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Bouton variante="discret" onClick={choisirLogo}>
                🖼 Choisir un logo
              </Bouton>
              {entLogo && (
                <Bouton variante="secondaire" onClick={retirerLogo}>
                  Retirer le logo
                </Bouton>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Champ label="Raison sociale / Nom">
              <input value={entNom} onChange={(e) => setEntNom(e.target.value)} className={inputCls} placeholder="SARL / EI ..." />
            </Champ>
            <Champ label="SIRET / SIREN / N° TVA">
              <input value={entSiret} onChange={(e) => setEntSiret(e.target.value)} className={inputCls} placeholder="Facultatif" />
            </Champ>
          </div>
          <Champ label="Adresse complète">
            <textarea value={entAdr} onChange={(e) => setEntAdr(e.target.value)} rows={3} className={inputCls} placeholder="Adresse, code postal, ville" />
          </Champ>
          <div className="grid grid-cols-2 gap-3">
            <Champ label="Téléphone">
              <input value={entTel} onChange={(e) => setEntTel(e.target.value)} className={inputCls} />
            </Champ>
            <Champ label="E-mail">
              <input value={entMail} onChange={(e) => setEntMail(e.target.value)} className={inputCls} />
            </Champ>
          </div>
          <Bouton onClick={enregistrerEntreprise}>💾 Enregistrer les infos entreprise</Bouton>
        </section>

        {/* Infos du commerce */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-semibold">🏪 Informations du commerce</h3>
          <Champ label="Nom du commerce">
            <input value={nom} onChange={(e) => setNom(e.target.value)} className={inputCls} />
          </Champ>
          <Champ label="Devise">
            <select value={devise} onChange={(e) => setDevise(e.target.value)} className={inputCls}>
              {DEVISES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label="Message du ticket de caisse">
            <input
              value={messageTicket}
              onChange={(e) => setMessageTicket(e.target.value)}
              className={inputCls}
            />
          </Champ>
          <Bouton onClick={enregistrerInfos}>💾 Enregistrer</Bouton>
        </section>

        {/* PIN */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-semibold">🔐 Code PIN du mode Caisse</h3>
          <p className="text-sm text-slate-500">
            {pinActif
              ? "Un code PIN est demandé pour ouvrir le mode caisse."
              : "Aucun PIN : le mode caisse est accessible à tous."}
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Champ label="Nouveau PIN (4 chiffres ou plus)">
                <input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className={inputCls}
                  placeholder="••••"
                />
              </Champ>
            </div>
            <Bouton onClick={changerPin}>Définir</Bouton>
            {pinActif && (
              <Bouton variante="danger" onClick={retirerPin}>
                Retirer
              </Bouton>
            )}
          </div>
        </section>

        {/* Sauvegarde */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-semibold">💾 Sauvegarde & restauration</h3>
          <p className="text-sm text-slate-500">
            Fichier de données : <code className="text-xs bg-slate-100 px-1 rounded">{dbPath || "…"}</code>
          </p>
          <p className="text-xs text-slate-400">
            Conseil : sauvegardez régulièrement (clé USB ou dossier cloud) et gardez les fichiers
            dans un endroit sûr.
          </p>
          <div className="flex gap-2">
            <Bouton variante="succes" onClick={sauvegarder} disabled={sauvegardeEnCours}>
              {sauvegardeEnCours ? "Sauvegarde…" : "⬇ Créer une sauvegarde"}
            </Bouton>
            <Bouton variante="danger" onClick={restaurer}>
              ⬆ Restaurer une sauvegarde
            </Bouton>
          </div>
        </section>

        {/* Zone dangereuse */}
        <section className="bg-white rounded-xl border border-red-200 p-4 space-y-3">
          <h3 className="font-semibold text-red-700">⚠️ Zone sensible</h3>
          <Bouton variante="danger" onClick={viderHistorique}>
            Vider l'historique des ventes
          </Bouton>
        </section>
      </div>
    </div>
  );
}
