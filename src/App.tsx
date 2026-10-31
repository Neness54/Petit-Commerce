import { useEffect, useState } from "react";
import { q, exec } from "./lib/db";
import { SettingsContext } from "./lib/settingsContext";
import type { Settings } from "./lib/types";
import Accueil from "./pages/Accueil";
import ModeCaisse from "./pages/caisse/ModeCaisse";
import ModeGestion from "./pages/gestion/ModeGestion";
import PinGate from "./components/PinGate";

type Mode = "accueil" | "caisse" | "gestion";

export default function App() {
  const [mode, setMode] = useState<Mode>("accueil");
  const [settings, setSettings] = useState<Settings>({});
  const [pret, setPret] = useState(false); // base chargée
  const [caisseDeverrouille, setCaisseDeverrouille] = useState(false); // PIN validé

  const reload = async () => {
    const rows = await q<{ cle: string; valeur: string }>("SELECT cle, valeur FROM parametres");
    const s: Settings = {};
    for (const r of rows) s[r.cle] = r.valeur;
    setSettings(s);
  };

  useEffect(() => {
    reload().finally(() => setPret(true));
  }, []);

  // F4 : basculer entre caisse et gestion (raccourci planifié)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F4") {
        e.preventDefault();
        setMode((m) => (m === "caisse" ? "gestion" : m === "gestion" ? "caisse" : "caisse"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = {
    settings,
    reload,
    get: (cle: string, defaut = "") => settings[cle] ?? defaut,
    devise: settings["devise"] || "EUR",
    nomCommerce: settings["nom_commerce"] || "Mon Commerce",
  };

  if (!pret) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-100 text-slate-500">
        Chargement…
      </div>
    );
  }

  const pinCaisse = settings["pin_caisse"] ?? "";
  const caisseProtège = pinCaisse !== "" && !caisseDeverrouille;

  return (
    <SettingsContext.Provider value={ctx}>
      <div className="h-screen overflow-hidden">
        {mode === "accueil" && <Accueil onChoisir={setMode} />}
        {mode === "caisse" &&
          (caisseProtège ? (
            <PinGate
              hashAttendu={pinCaisse}
              onValide={() => setCaisseDeverrouille(true)}
              onAnnuler={() => setMode("accueil")}
            />
          ) : (
            <ModeCaisse
              onQuitter={() => {
                setCaisseDeverrouille(false); // re-verrouiller en quittant
                setMode("accueil");
              }}
              onAllerGestion={() => setMode("gestion")}
            />
          ))}
        {mode === "gestion" && (
          <ModeGestion onQuitter={() => setMode("accueil")} onAllerCaisse={() => setMode("caisse")} />
        )}
      </div>
    </SettingsContext.Provider>
  );
}

/** Vide la table des ventes et remet le stock à zéro (fonction d'usine — usage interne) */
export async function reinitialiserTout(): Promise<void> {
  await exec("DELETE FROM lignes_vente");
  await exec("DELETE FROM ventes");
  await exec("UPDATE produits SET stock = 0");
}
