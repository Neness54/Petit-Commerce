import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** État du serveur local pour le scanner téléphone */
export interface PhoneInfo {
  running: boolean;
  port: number;
  ip: string;
  url: string;
  code: string;
  secondsLeft: number;
  qrSvg: string | null;
  appareils: { token: string; nom: string }[];
}

/** Demande de scan envoyée par le téléphone */
export interface PhoneScanRequest {
  requestId: string;
  code: string;
}

export interface ScanReply {
  ok: boolean;
  message: string;
  nom?: string | null;
  prix?: number | null;
  total: number;
  articles: number;
}

export const phoneStart = () => invoke<PhoneInfo>("phone_start");
export const phoneStop = () => invoke<PhoneInfo>("phone_stop");
export const phoneInfo = () => invoke<PhoneInfo>("phone_info");
export const phoneNewCode = () => invoke<PhoneInfo>("phone_new_code");
export const phoneRevoke = (token: string) => invoke<PhoneInfo>("phone_revoke", { token });

/** Met à jour le total du panier connu du serveur (affiché sur le téléphone) */
export const phoneSetPanier = (total: number, articles: number) =>
  invoke("phone_set_panier", { total, articles }).catch(() => {});

/** Réponse envoyée au téléphone pour une demande de scan */
export const phoneScanReply = (reply: ScanReply & { requestId: string }) =>
  invoke("phone_scan_reply", {
    requestId: reply.requestId,
    ok: reply.ok,
    message: reply.message,
    nom: reply.nom ?? null,
    prix: reply.prix ?? null,
    total: reply.total,
    articles: reply.articles,
  }).catch(() => {});

/** Écoute les scans provenant du téléphone */
export const onPhoneScan = (
  handler: (req: PhoneScanRequest) => void,
): Promise<UnlistenFn> =>
  listen<PhoneScanRequest>("phone-scan", (evt) => handler(evt.payload));
