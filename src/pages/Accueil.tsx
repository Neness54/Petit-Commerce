import { useSettings } from "../lib/settingsContext";

/** Écran d'accueil : choix entre les deux modes */
export default function Accueil({ onChoisir }: { onChoisir: (m: "caisse" | "gestion") => void }) {
  const { nomCommerce } = useSettings();
  const date = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700 text-white gap-10">
      <div className="text-center">
        <h1 className="text-4xl font-bold">{nomCommerce}</h1>
        <p className="text-slate-300 mt-2 capitalize">{date}</p>
      </div>

      <div className="flex gap-8 flex-wrap justify-center px-8">
        <button
          onClick={() => onChoisir("caisse")}
          className="w-72 h-56 rounded-2xl bg-green-600 hover:bg-green-500 transition-colors flex flex-col items-center justify-center gap-4 shadow-xl"
        >
          <span className="text-6xl">🛒</span>
          <span className="text-2xl font-bold">Mode Caisse</span>
          <span className="text-green-100 text-sm">Ventes, clients, dettes</span>
        </button>

        <button
          onClick={() => onChoisir("gestion")}
          className="w-72 h-56 rounded-2xl bg-blue-600 hover:bg-blue-500 transition-colors flex flex-col items-center justify-center gap-4 shadow-xl"
        >
          <span className="text-6xl">📦</span>
          <span className="text-2xl font-bold">Mode Gestion</span>
          <span className="text-blue-100 text-sm">Stock, fournisseurs, rapports</span>
        </button>
      </div>

      <p className="text-slate-400 text-sm">
        Raccourci : <kbd className="px-2 py-0.5 bg-slate-800 rounded">F4</kbd> pour basculer entre les
        deux modes
      </p>
    </div>
  );
}
