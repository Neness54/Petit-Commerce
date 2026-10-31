import { useState } from "react";
import { useSettings } from "../../lib/settingsContext";
import Dashboard from "./Dashboard";
import Categories from "./Categories";
import Stock from "./Stock";
import Fournisseurs from "./Fournisseurs";
import Commandes from "./Commandes";
import Parametres from "./Parametres";

type Onglet =
  | "dashboard"
  | "categories"
  | "stock"
  | "fournisseurs"
  | "commandes"
  | "parametres";

const ONGLETS: { id: Onglet; label: string; icone: string }[] = [
  { id: "dashboard", label: "Tableau de bord", icone: "📊" },
  { id: "categories", label: "Catégories", icone: "🗂" },
  { id: "stock", label: "Stock & lots", icone: "📦" },
  { id: "fournisseurs", label: "Fournisseurs", icone: "🚚" },
  { id: "commandes", label: "Commandes", icone: "📋" },
  { id: "parametres", label: "Paramètres", icone: "⚙️" },
];

/** Coquille du Mode Gestion : tout ce qui touche au stock et à l'organisation */
export default function ModeGestion({
  onQuitter,
  onAllerCaisse,
}: {
  onQuitter: () => void;
  onAllerCaisse: () => void;
}) {
  const [onglet, setOnglet] = useState<Onglet>("dashboard");
  const { nomCommerce } = useSettings();

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="bg-blue-800 text-white flex items-center px-4 gap-4 shadow">
        <span className="font-bold text-lg py-3 whitespace-nowrap">
          📦 {nomCommerce} — Gestion
        </span>
        <nav className="flex gap-1 ml-4 overflow-x-auto min-w-0">
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              onClick={() => setOnglet(o.id)}
              className={`px-3 py-2 rounded-t-lg font-medium whitespace-nowrap ${
                onglet === o.id ? "bg-slate-100 text-blue-900" : "hover:bg-blue-700"
              }`}
            >
              {o.icone} {o.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex gap-2 whitespace-nowrap">
          <button
            onClick={onAllerCaisse}
            className="px-3 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-sm"
            title="Basculer en mode caisse (F4)"
          >
            🛒 Caisse <kbd className="text-xs opacity-70">F4</kbd>
          </button>
          <button
            onClick={onQuitter}
            className="px-3 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-sm"
          >
            🏠 Accueil
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {onglet === "dashboard" && <Dashboard onAllerStock={() => setOnglet("stock")} onAllerCommandes={() => setOnglet("commandes")} />}
        {onglet === "categories" && <Categories />}
        {onglet === "stock" && <Stock />}
        {onglet === "fournisseurs" && <Fournisseurs />}
        {onglet === "commandes" && <Commandes />}
        {onglet === "parametres" && <Parametres />}
      </main>
    </div>
  );
}
