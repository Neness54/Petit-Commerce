import { useEffect, useState, type ReactNode } from "react";

/**
 * Zone d'impression : rend `contenu` dans #print-area puis déclenche l'impression.
 * Utilisation : <ZoneImpression contenu={<Ticket …/>} onTermine={…} />
 */
export default function ZoneImpression({
  contenu,
  onTermine,
}: {
  contenu: ReactNode;
  onTermine: () => void;
}) {
  const [pret, setPret] = useState(false);

  useEffect(() => {
    // Laisser React rendre la zone avant d'imprimer
    const t = setTimeout(() => {
      setPret(true);
      window.print();
      onTermine();
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return pret ? <div id="print-area">{contenu}</div> : null;
}
