import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

// Réexporte les utilitaires de formatage
export { fmtMoney, fmtNum, fmtDate, fmtDateTime, fmtHeure, todayISO } from "./format";

/** Sauvegarde un CSV via la boîte de dialogue d'enregistrement */
export async function saveCSV(
  nomFichier: string,
  headers: string[],
  rows: (string | number)[][],
): Promise<void> {
  const path = await save({
    defaultPath: nomFichier,
    filters: [{ name: "Fichier CSV", extensions: ["csv"] }],
  });
  if (!path) return; // annulé

  const esc = (v: string | number): string => {
    let s = String(v ?? "");
    if (typeof v === "number") s = String(v).replace(".", ",");
    if (s.includes(";") || s.includes('"') || s.includes("\n")) {
      s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(esc).join(";"), ...rows.map((r) => r.map(esc).join(";"))];
  // BOM UTF-8 pour qu'Excel l'ouvre correctement
  await writeTextFile(path, "\uFEFF" + lines.join("\r\n"));
}
