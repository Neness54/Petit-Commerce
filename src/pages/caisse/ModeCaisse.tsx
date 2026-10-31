import { useState } from "react";
import { useSettings } from "../../lib/settingsContext";
import Caisse from "./Caisse";
import Ventes from "./Ventes";
import Clients from "./Clients";
import StatsVentes from "./StatsVentes";

type Onglet = "caisse" | "ventes" | "clients" | "stats";

const ONGLETS: { id: Onglet; label: string; icone: string }[] = [
  { id: "caisse", label: "Caisse", icone: "🛒" },
  { id: "ventes", label: "Historique", icone: "🧾" },
  { id: "clients", label: "Clients", icone: "👥" },
  { id: "stats", label: "Statistiques", icone: "📈" },
];

/** Coquille du Mode Caisse : navigation par onglets, tout lié aux ventes */
export default function ModeCaisse({
  onQuitter,
  onAllerGestion,
}: {
  onQuitter: () => void;
  onAllerGestion: () => void;
}) {
  const [onglet, setOnglet] = useState<Onglet>("caisse");
  const { nomCommerce } = useSettings();

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="bg-green-700 text-white flex items-center px-4 gap-4 shadow">
        <span className="font-bold text-lg py-3">🛒 {nomCommerce} — Caisse</span>
        <nav className="flex gap-1 ml-4">
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              onClick={() => setOnglet(o.id)}
              className={`px-4 py-2 rounded-t-lg font-medium ${
                onglet === o.id ? "bg-slate-100 text-green-900" : "hover:bg-green-600"
              }`}
            >
              {o.icone} {o.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex gap-2">
          <button
            onClick={onAllerGestion}
            className="px-3 py-1.5 rounded-lg bg-green-800 hover:bg-green-900 text-sm"
            title="Basculer en mode gestion (F4)"
          >
            📦 Gestion <kbd className="text-xs opacity-70">F4</kbd>
          </button>
          <button
            onClick={onQuitter}
            className="px-3 py-1.5 rounded-lg bg-green-800 hover:bg-green-900 text-sm"
          >
            🏠 Accueil
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {onglet === "caisse" && <Caisse onAllerClients={() => setOnglet("clients")} />}
        {onglet === "ventes" && <Ventes />}
        {onglet === "clients" && <Clients />}
        {onglet === "stats" && <StatsVentes />}
      </main>
    </div>
  );
}
