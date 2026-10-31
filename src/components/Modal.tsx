import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface ModalProps {
  titre: string;
  onFermer: () => void;
  children: ReactNode;
  pied?: ReactNode;
  large?: boolean;
}

/** Fenêtre modale centrée, fermée par Échap ou clic extérieur */
export default function Modal({ titre, onFermer, children, pied, large }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFermer]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === ref.current) onFermer();
      }}
      ref={ref}
    >
      <div
        className={`bg-white rounded-xl shadow-2xl w-full ${large ? "max-w-4xl" : "max-w-lg"} max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold text-lg">{titre}</h2>
          <button
            onClick={onFermer}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none w-8 h-8 rounded hover:bg-slate-100"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {pied && <div className="px-5 py-3 border-t flex justify-end gap-2">{pied}</div>}
      </div>
    </div>
  );
}

/** Champ de formulaire standardisé */
export function Champ({
  label,
  children,
  large,
}: {
  label: string;
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <label className={`block ${large ? "" : ""}`}>
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export const inputCls =
  "w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Bouton principal / secondaire */
export function Bouton({
  children,
  onClick,
  variante = "primaire",
  type = "button",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variante?: "primaire" | "secondaire" | "danger" | "succes" | "discret";
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
}) {
  const styles: Record<string, string> = {
    primaire: "bg-blue-600 text-white hover:bg-blue-700",
    succes: "bg-green-600 text-white hover:bg-green-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    secondaire: "bg-slate-200 text-slate-800 hover:bg-slate-300",
    discret: "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variante]}`}
    >
      {children}
    </button>
  );
}
