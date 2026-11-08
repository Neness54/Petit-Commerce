import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { q, tx, CLIENTS_AVEC_DETTE, type Stmt } from "../../lib/db";
import { fmtMoney, fmtNum } from "../../lib/format";
import { useSettings } from "../../lib/settingsContext";
import { phoneScanReply, phoneSetPanier, onPhoneScan } from "../../lib/phoneScanner";
import type { Client, Produit } from "../../lib/types";
import { Bouton, Champ, inputCls } from "../../components/Modal";
import ImpressionVente from "./ImpressionVente";

interface LignePanier {
  produit: Produit;
  qte: number;
}

/** Écran de caisse : scan, panier, encaissement */
export default function Caisse({ onAllerClients }: { onAllerClients: () => void }) {
  const { devise, get } = useSettings();
  const [produits, setProduits] = useState<Produit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [panier, setPanier] = useState<LignePanier[]>([]);
  const [recherche, setRecherche] = useState("");
  const [recu, setRecu] = useState("");
  const [clientId, setClientId] = useState<number | "">("");
  const [modePaiement, setModePaiement] = useState<"espece" | "carte" | "credit">("espece");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [venteImprimee, setVenteImprimee] = useState<{
    numero: string;
    doc: "ticket" | "facture";
  } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const chargerProduits = async () => {
    const p = await q<Produit>(
      "SELECT * FROM produits WHERE actif = 1 AND stock > 0 ORDER BY nom COLLATE NOCASE",
    );
    setProduits(p);
  };
  const chargerClients = async () => {
    const c = await q<Client>(CLIENTS_AVEC_DETTE);
    setClients(c);
  };

  useEffect(() => {
    chargerProduits();
    chargerClients();
    scanRef.current?.focus();
  }, []);

  const total = useMemo(
    () => panier.reduce((s, l) => s + l.qte * l.produit.prix_vente, 0),
    [panier],
  );

  // Miroir du panier pour les callbacks du scanner téléphone
  const panierRef = useRef<LignePanier[]>([]);
  useEffect(() => {
    panierRef.current = panier;
  }, [panier]);

  const totalDe = (pan: LignePanier[]) =>
    pan.reduce((s, l) => s + l.qte * l.produit.prix_vente, 0);
  const articlesDe = (pan: LignePanier[]) => pan.reduce((s, l) => s + l.qte, 0);
  const montantRecuSaisi =
    recu.trim() === "" ? null : parseFloat(recu.replace(",", ".")) || 0;
  // En espèces, un montant vide signifie « comptant exact »
  const montantRecu = montantRecuSaisi ?? total;
  const monnaie = montantRecu - total;

  const filtres = useMemo(() => {
    const r = recherche.trim().toLowerCase();
    if (!r) return produits.slice(0, 60);
    return produits
      .filter(
        (p) =>
          p.nom.toLowerCase().includes(r) ||
          (p.code_barres ?? "").toLowerCase().includes(r),
      )
      .slice(0, 60);
  }, [recherche, produits]);

  /** Ajoute un produit au panier et renvoie le résultat (utilisé par le scan téléphone) */
  function ajouterAuPanier(p: Produit): {
    ok: boolean;
    message: string;
    total: number;
    articles: number;
  } {
    const pan = panierRef.current;
    const i = pan.findIndex((l) => l.produit.id === p.id);
    const dejaQte = i >= 0 ? pan[i].qte : 0;
    if (dejaQte + 1 > p.stock) {
      const message = `Stock insuffisant pour « ${p.nom} » (disponible : ${fmtNum(p.stock)})`;
      setErreur(message);
      scanRef.current?.focus();
      return {
        ok: false,
        message,
        total: totalDe(pan),
        articles: articlesDe(pan),
      };
    }
    const nouveau =
      i >= 0
        ? pan.map((l, idx) => (idx === i ? { ...l, qte: l.qte + 1 } : l))
        : [...pan, { produit: p, qte: 1 }];
    panierRef.current = nouveau;
    setPanier(nouveau);
    setErreur(null);
    setRecherche("");
    scanRef.current?.focus();
    return {
      ok: true,
      message: `${p.nom} ajouté`,
      total: totalDe(nouveau),
      articles: articlesDe(nouveau),
    };
  }

  function ajouterProduit(p: Produit) {
    ajouterAuPanier(p);
  }

  // Le téléphone voit le total du panier en cours
  useEffect(() => {
    phoneSetPanier(total, panier.reduce((s, l) => s + l.qte, 0));
  }, [panier, total]);

  // Scan envoyé depuis le téléphone (même chemin que le scanner USB)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let annule = false;

    onPhoneScan(async ({ requestId, code }) => {
      const rechercheCode = (code ?? "").trim().toLowerCase();
      const produit = produits.find(
        (p) => (p.code_barres ?? "").toLowerCase() === rechercheCode,
      );

      if (!produit) {
        await phoneScanReply({
          requestId,
          ok: false,
          message: "Produit non reconnu",
          nom: null,
          prix: null,
          total: totalDe(panierRef.current),
          articles: articlesDe(panierRef.current),
        });
        return;
      }

      const r = ajouterAuPanier(produit);
      await phoneScanReply({
        requestId,
        ok: r.ok,
        message: r.message,
        nom: produit.nom,
        prix: produit.prix_vente,
        total: r.total,
        articles: r.articles,
      });
    })
      .then((un) => {
        if (annule) un();
        else unlisten = un;
      })
      .catch(() => {});

    return () => {
      annule = true;
      unlisten?.();
    };
  }, [produits]);

  function changerQte(idx: number, qte: number) {
    setPanier((pan) => {
      // Un lot pesé se vend à la pièce : pas de demi-pièce
      if (pan[idx].produit.unite === "pièce") qte = Math.floor(qte);
      if (qte <= 0) return pan.filter((_, i) => i !== idx);
      if (qte > pan[idx].produit.stock) {
        setErreur(`Stock insuffisant (disponible : ${fmtNum(pan[idx].produit.stock)})`);
        return pan;
      }
      const copie = [...pan];
      copie[idx] = { ...copie[idx], qte };
      return copie;
    });
  }

  /** Entrée dans le champ scan : code-barres exact ou recherche */
  function onScanEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const code = recherche.trim();
    if (!code) return;
    const exact = produits.find((p) => p.code_barres?.toLowerCase() === code.toLowerCase());
    if (exact) {
      ajouterProduit(exact);
    } else if (filtres.length === 1) {
      ajouterProduit(filtres[0]);
    }
  }

  const clientSel = clients.find((c) => c.id === clientId);
  const detteApres =
    modePaiement === "credit" && clientSel ? (clientSel.dette ?? 0) + total : 0;
  const plafondDepasse =
    modePaiement === "credit" && clientSel != null && clientSel.plafond_credit > 0
      ? detteApres > clientSel.plafond_credit
      : false;

  /** Enregistre la vente (transaction atomique) */
  async function encaisser() {
    if (enCours) return;
    setErreur(null);
    if (panier.length === 0) return setErreur("Le panier est vide.");
    if (modePaiement === "espece" && montantRecuSaisi !== null && montantRecu < total) {
      return setErreur("Le montant reçu est inférieur au total.");
    }
    if (modePaiement === "credit" && clientId === "") {
      return setErreur("Sélectionnez un client pour une vente à crédit.");
    }
    if (plafondDepasse) {
      const ok = window.confirm(
        `Plafond de crédit dépassé pour ${clientSel?.nom} (${fmtMoney(clientSel?.plafond_credit, devise)}). Continuer quand même ?`,
      );
      if (!ok) return;
    }

    const numero = `V${Date.now().toString(36).toUpperCase()}`;
    const montantPaye = modePaiement === "credit" ? 0 : total;
    const recuEnregistre =
      modePaiement === "espece" ? montantRecu : modePaiement === "carte" ? total : 0;

    setEnCours(true);
    try {
      // Transaction atomique : la sous-requête sur `numero` (unique) relie les lignes à la vente
      const statements: Stmt[] = [
        {
          sql: "INSERT INTO ventes (numero, client_id, montant_total, montant_paye, montant_recu, mode_paiement) VALUES (?, ?, ?, ?, ?, ?)",
          params: [
            numero,
            clientId === "" ? null : clientId,
            total,
            montantPaye,
            recuEnregistre,
            modePaiement,
          ],
        },
      ];
      for (const l of panier) {
        statements.push({
          sql: `INSERT INTO lignes_vente (vente_id, produit_id, nom_produit, quantite, prix_unitaire, prix_achat)
                VALUES ((SELECT id FROM ventes WHERE numero = ?), ?, ?, ?, ?, ?)`,
          params: [numero, l.produit.id, l.produit.nom, l.qte, l.produit.prix_vente, l.produit.prix_achat],
        });
        statements.push({
          sql: "UPDATE produits SET stock = stock - ? WHERE id = ?",
          params: [l.qte, l.produit.id],
        });
        statements.push({
          sql: "INSERT INTO mouvements_stock (produit_id, type, quantite, motif, reference) VALUES (?, 'vente', ?, ?, ?)",
          params: [l.produit.id, -l.qte, `Vente ${numero}`, numero],
        });
      }
      await tx(statements);
    } catch (e) {
      setErreur(`Échec de la vente : ${e}`);
      setEnCours(false);
      return;
    }
    setEnCours(false);

    setPanier([]);
    setRecu("");
    const avaitClient = clientId !== "";
    setClientId("");
    setModePaiement("espece");
    chargerProduits();
    chargerClients();
    // Ouvre la fenêtre ticket / facture (facture par défaut si un client est renseigné)
    setVenteImprimee({ numero, doc: avaitClient ? "facture" : "ticket" });
    scanRef.current?.focus();
  }

  function viderPanier() {
    if (panier.length === 0) return;
    if (window.confirm("Vider le panier ?")) {
      setPanier([]);
      scanRef.current?.focus();
    }
  }

  return (
    <div className="h-full flex">
      {/* ---------- Colonne gauche : recherche + produits ---------- */}
      <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
        <input
          ref={scanRef}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          onKeyDown={onScanEnter}
          placeholder="📷 Scannez un code-barres ou tapez un nom…"
          className="w-full text-xl px-4 py-3 border-2 border-green-600 rounded-xl focus:outline-none focus:ring-4 focus:ring-green-200"
          autoFocus
        />

        <div className="flex-1 overflow-y-auto">
          {filtres.length === 0 ? (
            <p className="text-slate-400 text-center mt-10">Aucun produit trouvé.</p>
          ) : (
            <div className="grid grid-cols-3 xl:grid-cols-4 gap-2">
              {filtres.map((p) => {
                const rupture = p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => ajouterProduit(p)}
                    disabled={rupture}
                    className={`text-left p-3 rounded-xl border bg-white hover:border-green-500 hover:shadow transition ${
                      rupture ? "opacity-40 cursor-not-allowed" : ""
                    }`}
                  >
                    <div className="font-medium text-sm leading-tight line-clamp-2">{p.nom}</div>
                    <div className="mt-1 font-bold text-green-700">
                      {fmtMoney(p.prix_vente, devise)}
                    </div>
                    <div
                      className={`text-xs mt-0.5 ${rupture ? "text-red-600 font-semibold" : p.stock <= p.seuil_alerte ? "text-orange-600" : "text-slate-400"}`}
                    >
                      {rupture ? "Rupture" : `${fmtNum(p.stock)} ${p.unite}`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Colonne droite : panier ---------- */}
      <div className="w-[400px] bg-white border-l flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-bold text-lg">Panier</h2>
          <button
            onClick={viderPanier}
            className="text-sm text-red-600 hover:underline disabled:opacity-30"
            disabled={panier.length === 0}
          >
            🗑 Vider
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {panier.length === 0 ? (
            <p className="text-slate-400 text-center mt-10 px-4">
              Panier vide.<br />Scannez un produit pour commencer.
            </p>
          ) : (
            panier.map((l, i) => (
              <div key={l.produit.id} className="px-4 py-2.5 border-b flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{l.produit.nom}</div>
                  <div className="text-xs text-slate-500">
                    {fmtMoney(l.produit.prix_vente, devise)} / {l.produit.unite}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => changerQte(i, l.qte - 1)}
                    className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 font-bold"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={l.produit.unite === "pièce" ? 1 : 0.01}
                    step={l.produit.unite === "pièce" ? 1 : "any"}
                    value={l.qte}
                    onChange={(e) => changerQte(i, parseFloat(e.target.value) || 0)}
                    className="w-16 text-center border rounded px-1 py-1"
                  />
                  <button
                    onClick={() => changerQte(i, l.qte + 1)}
                    className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 font-bold"
                  >
                    +
                  </button>
                </div>
                <div className="w-20 text-right font-semibold text-sm">
                  {fmtMoney(l.qte * l.produit.prix_vente, devise)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ---------- Encaissement ---------- */}
        <div className="border-t p-4 space-y-3 bg-slate-50 max-h-[70vh] overflow-y-auto">
          {erreur && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {erreur}
            </div>
          )}

          <div className="flex justify-between items-baseline">
            <span className="text-slate-600">Total</span>
            <span className="text-3xl font-bold text-green-700">{fmtMoney(total, devise)}</span>
          </div>

          {/* Mode de paiement */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => setModePaiement("espece")}
              className={`py-2 rounded-lg text-sm font-medium border-2 ${
                modePaiement === "espece"
                  ? "border-green-600 bg-green-50 text-green-800"
                  : "border-slate-200 text-slate-500"
              }`}
            >
              💵 Espèces
            </button>
            <button
              onClick={() => setModePaiement("carte")}
              className={`py-2 rounded-lg text-sm font-medium border-2 ${
                modePaiement === "carte"
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-slate-200 text-slate-500"
              }`}
            >
              💳 Carte
            </button>
            <button
              onClick={() => setModePaiement("credit")}
              className={`py-2 rounded-lg text-sm font-medium border-2 ${
                modePaiement === "credit"
                  ? "border-orange-500 bg-orange-50 text-orange-800"
                  : "border-slate-200 text-slate-500"
              }`}
            >
              📝 Crédit
            </button>
          </div>

          {/* Client : facultatif en espèces / carte, obligatoire en crédit */}
          <Champ label={modePaiement === "credit" ? "Client *" : "Client (facultatif)"}>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : "")}
              className={inputCls}
            >
              <option value="">
                {modePaiement === "credit" ? "— Choisir un client —" : "— Aucun client (comptant) —"}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                  {(c.dette ?? 0) > 0 ? ` — dette : ${fmtMoney(c.dette, devise)}` : ""}
                </option>
              ))}
            </select>
          </Champ>

          {clientSel && (
            <div className="text-xs space-y-0.5 -mt-1">
              <p className="text-slate-500">
                {clientSel.telephone && <>📞 {clientSel.telephone} · </>}
                Dette actuelle : <b>{fmtMoney(clientSel.dette, devise)}</b>
                {clientSel.plafond_credit > 0 && (
                  <>
                    {" · "}Plafond : <b>{fmtMoney(clientSel.plafond_credit, devise)}</b>
                  </>
                )}
              </p>
              {modePaiement === "credit" && (
                <p className="text-slate-500">
                  Dette après cette vente : <b>{fmtMoney(detteApres, devise)}</b>
                </p>
              )}
              {plafondDepasse && (
                <p className="text-red-600 font-semibold">
                  ⚠️ Ce crédit dépasse le plafond autorisé.
                </p>
              )}
            </div>
          )}

          {modePaiement === "credit" && clientId === "" && panier.length > 0 && (
            <p className="text-xs text-orange-700">
              Un client est nécessaire pour enregistrer une vente à crédit.
            </p>
          )}

          {modePaiement === "espece" && (
            <div className="grid grid-cols-2 gap-2">
              <Champ label="Montant reçu (vide = exact)">
                <input
                  value={recu}
                  onChange={(e) => setRecu(e.target.value)}
                  inputMode="decimal"
                  placeholder={total > 0 ? total.toFixed(2).replace(".", ",") : "0,00"}
                  className={inputCls}
                />
              </Champ>
              <Champ label="À rendre">
                <div
                  className={`${inputCls} bg-white font-semibold ${
                    recu.trim() === "" ? "text-slate-400" : monnaie < 0 ? "text-red-600" : "text-green-700"
                  }`}
                >
                  {recu.trim() === "" ? "—" : monnaie >= 0 ? fmtMoney(monnaie, devise) : "Insuffisant"}
                </div>
              </Champ>
              {/* Boutons d'aide : montants courants */}
              <div className="col-span-2 flex gap-1.5 flex-wrap">
                {[5, 10, 20, 50].map((d) => (
                  <button
                    key={d}
                    onClick={() => setRecu(String(d))}
                    className="px-2.5 py-1 text-xs rounded bg-slate-200 hover:bg-slate-300"
                  >
                    {d} €
                  </button>
                ))}
                <button
                  onClick={() => setRecu(total.toFixed(2).replace(".", ","))}
                  className="px-2.5 py-1 text-xs rounded bg-green-100 text-green-800 hover:bg-green-200 font-medium"
                >
                  Exact
                </button>
                <button
                  onClick={() => setRecu("")}
                  className="px-2.5 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200"
                >
                  Effacer
                </button>
              </div>
            </div>
          )}

          {modePaiement === "carte" && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
              💳 Paiement par carte : la totalité de <b>{fmtMoney(total, devise)}</b> sera
              enregistrée comme payée.
            </div>
          )}

          {modePaiement === "credit" && clientSel && (
            <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-sm text-orange-800">
              📝 Vente à crédit : <b>{fmtMoney(total, devise)}</b> seront ajoutés à la dette de{" "}
              {clientSel.nom}.
            </div>
          )}

          <Bouton onClick={encaisser} variante="succes" disabled={panier.length === 0 || enCours}>
            <span className="text-lg">
              {enCours
                ? "Encaissement…"
                : `✔ Encaisser ${total > 0 ? fmtMoney(total, devise) : ""}`}
            </span>
          </Bouton>

          <button
            onClick={onAllerClients}
            className="w-full text-xs text-slate-400 hover:text-slate-600"
          >
            Gérer les clients →
          </button>
        </div>
      </div>

      {/* ---------- Ticket / facture après la vente ---------- */}
      {venteImprimee && (
        <ImpressionVente
          venteNumero={venteImprimee.numero}
          documentInitial={venteImprimee.doc}
          onFermer={() => setVenteImprimee(null)}
        />
      )}
    </div>
  );
}
