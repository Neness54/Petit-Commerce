/** Formatage monétaire : 12,50 € */
export function fmtMoney(v: number | null | undefined, devise = "EUR"): string {
  const n = Number(v ?? 0);
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: devise,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${devise}`;
  }
}

/** Nombre simple, sans décimales inutiles : 3 ou 2,5 */
export function fmtNum(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n);
}

/** Date -> 20/10/2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR");
}

/** Date + heure -> 20/10/2026 14:32 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Heure seule -> 14:32 */
export function fmtHeure(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Date SQL locale (YYYY-MM-DD) */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Date SQL locale (YYYY-MM-DD) -> JJ/MM/AAAA */
export function fmtDateFr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const parts = d.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/** Construit une chaîne CSV (séparateur ;, décimales ,) avec BOM pour Excel */
export function toCSV(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number): string => {
    let s = String(v ?? "");
    if (typeof v === "number") s = String(v).replace(".", ",");
    if (s.includes(";") || s.includes('"') || s.includes("\n")) {
      s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(esc).join(";"), ...rows.map((r) => r.map(esc).join(";"))];
  return "\uFEFF" + lines.join("\r\n");
}
