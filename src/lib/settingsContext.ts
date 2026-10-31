import { createContext, useContext } from "react";
import type { Settings } from "./types";

interface SettingsContextValue {
  settings: Settings;
  reload: () => Promise<void>;
  /** Raccourci pour lire un paramètre */
  get: (cle: string, defaut?: string) => string;
  devise: string;
  nomCommerce: string;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: {},
  reload: async () => {},
  get: (_cle: string, defaut = "") => defaut,
  devise: "EUR",
  nomCommerce: "Mon Commerce",
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
