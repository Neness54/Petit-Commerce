import { useState } from "react";
import { sha256Hex } from "../lib/sha256";
import { Bouton, Champ, inputCls } from "./Modal";

/** Écran de déverrouillage du mode caisse par code PIN */
export default function PinGate({
  hashAttendu,
  onValide,
  onAnnuler,
}: {
  hashAttendu: string;
  onValide: () => void;
  onAnnuler: () => void;
}) {
  const [pin, setPin] = useState("");
  const [erreur, setErreur] = useState(false);

  async function valider() {
    const h = await sha256Hex("pc-pin:" + pin);
    if (h === hashAttendu) {
      onValide();
    } else {
      setErreur(true);
      setPin("");
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-slate-900">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-96 space-y-4">
        <div className="text-center">
          <span className="text-4xl">🛒</span>
          <h2 className="text-xl font-bold mt-2">Mode Caisse</h2>
          <p className="text-sm text-slate-500">Entrez le code PIN pour continuer</p>
        </div>
        {erreur && <p className="text-red-600 text-sm text-center">Code incorrect.</p>}
        <Champ label="Code PIN">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => {
              setErreur(false);
              setPin(e.target.value.replace(/\D/g, "").slice(0, 10));
            }}
            onKeyDown={(e) => e.key === "Enter" && valider()}
            className={`${inputCls} text-center text-2xl tracking-widest`}
          />
        </Champ>
        <div className="flex gap-2">
          <Bouton variante="secondaire" onClick={onAnnuler}>
            Retour
          </Bouton>
          <Bouton onClick={valider} variante="succes">
            Déverrouiller
          </Bouton>
        </div>
      </div>
    </div>
  );
}
