import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Rend un code-barres CODE128 en SVG (imprimable) */
export default function CodeBarres({
  valeur,
  largeur = 2,
  hauteur = 40,
  texte = true,
}: {
  valeur: string;
  largeur?: number;
  hauteur?: number;
  texte?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !valeur) return;
    try {
      JsBarcode(ref.current, valeur, {
        format: "CODE128",
        width: largeur,
        height: hauteur,
        displayValue: texte,
        fontSize: 12,
        margin: 0,
      });
    } catch {
      /* valeur invalide pour Code128 : ne rien afficher */
    }
  }, [valeur, largeur, hauteur, texte]);

  return <svg ref={ref} />;
}
