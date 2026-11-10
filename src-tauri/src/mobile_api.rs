//! API de la caisse mobile (app iPhone).
//!
//! Le PC reste la référence : l'iPhone lit les produits, les clients et les
//! informations du commerce dans la base du PC, et ses ventes y sont enregistrées
//! avec les mêmes écritures que la caisse du PC (vente, lignes, stock, mouvements).
//! Les prix, le stock et le plafond de crédit sont toujours vérifiés ici.
//!
//! Toutes les routes exigent le jeton obtenu par l'appairage (`/api/pair`).

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use tauri::{AppHandle, Emitter, Manager};

use crate::phone_server::{bearer, Appareil, Ctx};

/// Événement envoyé à l'interface du PC après une vente faite sur l'iPhone
pub const EVT_VENTES_MODIFIEES: &str = "ventes-modifiees";

// ---------------------------------------------------------------------------
// Base de données
// ---------------------------------------------------------------------------

/// Ouvre la base du commerce (même fichier et mêmes réglages que `execute_transaction`).
pub(crate) async fn ouvrir_base(app: &AppHandle) -> Result<SqlitePool, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let opts = SqliteConnectOptions::new()
        .filename(dir.join("petit-commerce.db"))
        .create_if_missing(true)
        .busy_timeout(Duration::from_secs(10));
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())
}

/// Table des appareils appairés, pour qu'ils restent autorisés après un redémarrage.
const SQL_TABLE_APPAREILS: &str = "CREATE TABLE IF NOT EXISTS appareils_mobiles (
  token TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
)";

pub(crate) async fn charger_appareils(app: &AppHandle) -> Result<Vec<Appareil>, String> {
    let pool = ouvrir_base(app).await?;
    sqlx::query(SQL_TABLE_APPAREILS)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let lignes = sqlx::query("SELECT token, nom FROM appareils_mobiles ORDER BY cree_le")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    pool.close().await;

    lignes
        .iter()
        .map(|l| -> Result<Appareil, String> {
            Ok(Appareil {
                token: l.try_get("token").map_err(|e| e.to_string())?,
                nom: l.try_get("nom").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

pub(crate) async fn enregistrer_appareil(app: &AppHandle, appareil: &Appareil) -> Result<(), String> {
    let pool = ouvrir_base(app).await?;
    sqlx::query(SQL_TABLE_APPAREILS)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("INSERT OR REPLACE INTO appareils_mobiles (token, nom) VALUES (?, ?)")
        .bind(&appareil.token)
        .bind(&appareil.nom)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    pool.close().await;
    Ok(())
}

pub(crate) async fn supprimer_appareil(app: &AppHandle, token: &str) -> Result<(), String> {
    let pool = ouvrir_base(app).await?;
    sqlx::query(SQL_TABLE_APPAREILS)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM appareils_mobiles WHERE token = ?")
        .bind(token)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    pool.close().await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Erreur {
    erreur: String,
    code: &'static str,
}

type Echec = (StatusCode, Json<Erreur>);
type Reponse<T> = Result<Json<T>, Echec>;

fn echec(statut: StatusCode, code: &'static str, message: impl Into<String>) -> Echec {
    (
        statut,
        Json(Erreur {
            erreur: message.into(),
            code,
        }),
    )
}

fn echec_base(e: impl std::fmt::Display) -> Echec {
    echec(
        StatusCode::INTERNAL_SERVER_ERROR,
        "base",
        format!("Erreur de la base de données : {e}"),
    )
}

fn verifier(ctx: &Ctx, headers: &HeaderMap) -> Result<Appareil, Echec> {
    ctx.phone.appareil(&bearer(headers)).ok_or_else(|| {
        echec(
            StatusCode::UNAUTHORIZED,
            "non_autorise",
            "Appareil non autorisé : refaites l'appairage avec le code du PC",
        )
    })
}

async fn base(ctx: &Ctx) -> Result<SqlitePool, Echec> {
    ouvrir_base(&ctx.app).await.map_err(echec_base)
}

fn texte_ou_vide(valeur: Option<String>) -> String {
    valeur.unwrap_or_default()
}

/// Champ facultatif : une chaîne vide est enregistrée comme NULL, comme sur le PC.
fn facultatif(valeur: &Option<String>) -> Option<String> {
    valeur
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

// ---------------------------------------------------------------------------
// Session : informations du commerce
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Commerce {
    nom: String,
    adresse: String,
    telephone: String,
    email: String,
    siret: String,
}

#[derive(Serialize)]
pub struct Session {
    appareil: String,
    devise: String,
    commerce: Commerce,
}

pub async fn session(State(ctx): State<Ctx>, headers: HeaderMap) -> Reponse<Session> {
    let appareil = verifier(&ctx, &headers)?;
    let pool = base(&ctx).await?;
    let lignes = sqlx::query("SELECT cle, valeur FROM parametres")
        .fetch_all(&pool)
        .await
        .map_err(echec_base)?;
    pool.close().await;

    let mut p: HashMap<String, String> = HashMap::new();
    for l in &lignes {
        let cle: String = l.try_get("cle").map_err(echec_base)?;
        let valeur: String = l.try_get("valeur").map_err(echec_base)?;
        p.insert(cle, valeur);
    }
    let lire = |cle: &str| p.get(cle).cloned().unwrap_or_default();

    // Même règle que la facture du PC : le nom de l'entreprise, sinon celui du commerce
    let nom_entreprise = lire("entreprise_nom");
    let nom = if nom_entreprise.trim().is_empty() {
        lire("nom_commerce")
    } else {
        nom_entreprise
    };
    let devise = lire("devise");

    Ok(Json(Session {
        appareil: appareil.nom,
        devise: if devise.is_empty() { "EUR".into() } else { devise },
        commerce: Commerce {
            nom,
            adresse: lire("entreprise_adresse"),
            telephone: lire("entreprise_telephone"),
            email: lire("entreprise_email"),
            siret: lire("entreprise_siret"),
        },
    }))
}

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ProduitMobile {
    id: i64,
    nom: String,
    code_barres: Option<String>,
    prix_vente: f64,
    stock: f64,
    unite: String,
}

pub async fn produits(State(ctx): State<Ctx>, headers: HeaderMap) -> Reponse<Vec<ProduitMobile>> {
    verifier(&ctx, &headers)?;
    let pool = base(&ctx).await?;
    let lignes = sqlx::query(
        "SELECT id, nom, code_barres, prix_vente, stock, unite
           FROM produits
          WHERE actif = 1
          ORDER BY nom COLLATE NOCASE",
    )
    .fetch_all(&pool)
    .await
    .map_err(echec_base)?;
    pool.close().await;

    let mut resultat = Vec::with_capacity(lignes.len());
    for l in &lignes {
        resultat.push(ProduitMobile {
            id: l.try_get("id").map_err(echec_base)?,
            nom: l.try_get("nom").map_err(echec_base)?,
            code_barres: l.try_get("code_barres").map_err(echec_base)?,
            prix_vente: l.try_get("prix_vente").map_err(echec_base)?,
            stock: l.try_get("stock").map_err(echec_base)?,
            unite: l.try_get("unite").map_err(echec_base)?,
        });
    }
    Ok(Json(resultat))
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/// Même calcul de dette que `CLIENTS_AVEC_DETTE` (src/lib/db.ts).
/// Les CAST AS REAL évitent qu'un total nul (0 entier) ne soit lu comme un entier.
const SQL_CLIENTS: &str = "
  SELECT c.id, c.nom, c.telephone, c.email, c.adresse, c.plafond_credit,
    CAST(MAX(0,
      COALESCE((SELECT SUM(v.montant_total - v.montant_paye)
                FROM ventes v
                WHERE v.client_id = c.id AND v.mode_paiement = 'credit' AND v.annulee = 0), 0)
      - COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.client_id = c.id), 0)
    ) AS REAL) AS dette
  FROM clients c
  WHERE c.actif = 1";

#[derive(Serialize)]
pub struct ClientMobile {
    id: i64,
    nom: String,
    telephone: String,
    email: String,
    adresse: String,
    plafond_credit: f64,
    dette: f64,
}

fn lire_client(l: &sqlx::sqlite::SqliteRow) -> Result<ClientMobile, Echec> {
    Ok(ClientMobile {
        id: l.try_get("id").map_err(echec_base)?,
        nom: l.try_get("nom").map_err(echec_base)?,
        telephone: texte_ou_vide(l.try_get("telephone").map_err(echec_base)?),
        email: texte_ou_vide(l.try_get("email").map_err(echec_base)?),
        adresse: texte_ou_vide(l.try_get("adresse").map_err(echec_base)?),
        plafond_credit: l.try_get("plafond_credit").map_err(echec_base)?,
        dette: l.try_get("dette").map_err(echec_base)?,
    })
}

pub async fn clients(State(ctx): State<Ctx>, headers: HeaderMap) -> Reponse<Vec<ClientMobile>> {
    verifier(&ctx, &headers)?;
    let pool = base(&ctx).await?;
    let lignes = sqlx::query(&format!("{SQL_CLIENTS} ORDER BY c.nom COLLATE NOCASE"))
        .fetch_all(&pool)
        .await
        .map_err(echec_base)?;
    pool.close().await;

    lignes.iter().map(lire_client).collect::<Result<Vec<_>, _>>().map(Json)
}

#[derive(Deserialize)]
pub struct NouveauClient {
    nom: String,
    #[serde(default)]
    telephone: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    adresse: Option<String>,
}

pub async fn creer_client(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Json(req): Json<NouveauClient>,
) -> Reponse<ClientMobile> {
    verifier(&ctx, &headers)?;
    let nom = req.nom.trim().to_string();
    if nom.is_empty() {
        return Err(echec(StatusCode::BAD_REQUEST, "nom", "Le nom du client est obligatoire"));
    }

    let pool = base(&ctx).await?;
    let id = sqlx::query("INSERT INTO clients (nom, telephone, email, adresse) VALUES (?, ?, ?, ?)")
        .bind(&nom)
        .bind(facultatif(&req.telephone))
        .bind(facultatif(&req.email))
        .bind(facultatif(&req.adresse))
        .execute(&pool)
        .await
        .map_err(echec_base)?
        .last_insert_rowid();

    let ligne = sqlx::query(&format!("{SQL_CLIENTS} AND c.id = ?"))
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(echec_base)?;
    pool.close().await;

    let _ = ctx.app.emit(EVT_VENTES_MODIFIEES, ());
    lire_client(&ligne).map(Json)
}

// ---------------------------------------------------------------------------
// Ventes
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct LigneMobile {
    nom: String,
    quantite: f64,
    prix_unitaire: f64,
}

#[derive(Serialize)]
pub struct ClientFacture {
    id: i64,
    nom: String,
    telephone: String,
    email: String,
    adresse: String,
}

#[derive(Serialize)]
pub struct VenteMobile {
    numero: String,
    date: String,
    mode_paiement: String,
    montant_total: f64,
    montant_paye: f64,
    montant_recu: Option<f64>,
    client: Option<ClientFacture>,
    lignes: Vec<LigneMobile>,
}

const SQL_VENTES: &str = "
  SELECT v.id, v.numero, v.cree_le, v.mode_paiement, v.montant_total, v.montant_paye,
         v.montant_recu, v.client_id, c.nom AS client_nom, c.telephone AS client_telephone,
         c.email AS client_email, c.adresse AS client_adresse
    FROM ventes v
    LEFT JOIN clients c ON c.id = v.client_id
   WHERE v.annulee = 0";

async fn lire_ventes(pool: &SqlitePool, lignes_ventes: Vec<sqlx::sqlite::SqliteRow>) -> Result<Vec<VenteMobile>, Echec> {
    let mut ventes = Vec::with_capacity(lignes_ventes.len());
    for v in &lignes_ventes {
        let id: i64 = v.try_get("id").map_err(echec_base)?;
        let client_id: Option<i64> = v.try_get("client_id").map_err(echec_base)?;
        let client_nom: Option<String> = v.try_get("client_nom").map_err(echec_base)?;

        let client = match (client_id, client_nom) {
            (Some(id), Some(nom)) => Some(ClientFacture {
                id,
                nom,
                telephone: texte_ou_vide(v.try_get("client_telephone").map_err(echec_base)?),
                email: texte_ou_vide(v.try_get("client_email").map_err(echec_base)?),
                adresse: texte_ou_vide(v.try_get("client_adresse").map_err(echec_base)?),
            }),
            _ => None,
        };

        let lignes = sqlx::query(
            "SELECT nom_produit, quantite, prix_unitaire FROM lignes_vente WHERE vente_id = ? ORDER BY id",
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(echec_base)?
        .iter()
        .map(|l| -> Result<LigneMobile, Echec> {
            Ok(LigneMobile {
                nom: l.try_get("nom_produit").map_err(echec_base)?,
                quantite: l.try_get("quantite").map_err(echec_base)?,
                prix_unitaire: l.try_get("prix_unitaire").map_err(echec_base)?,
            })
        })
        .collect::<Result<Vec<_>, Echec>>()?;

        ventes.push(VenteMobile {
            numero: v.try_get("numero").map_err(echec_base)?,
            date: v.try_get("cree_le").map_err(echec_base)?,
            mode_paiement: v.try_get("mode_paiement").map_err(echec_base)?,
            montant_total: v.try_get("montant_total").map_err(echec_base)?,
            montant_paye: v.try_get("montant_paye").map_err(echec_base)?,
            montant_recu: v.try_get("montant_recu").map_err(echec_base)?,
            client,
            lignes,
        });
    }
    Ok(ventes)
}

#[derive(Deserialize)]
pub struct FiltreVentes {
    client_id: Option<i64>,
    limite: Option<i64>,
}

pub async fn ventes(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Query(filtre): Query<FiltreVentes>,
) -> Reponse<Vec<VenteMobile>> {
    verifier(&ctx, &headers)?;
    let limite = filtre.limite.unwrap_or(100).clamp(1, 500);
    let pool = base(&ctx).await?;

    let lignes = match filtre.client_id {
        Some(client_id) => {
            sqlx::query(&format!("{SQL_VENTES} AND v.client_id = ? ORDER BY v.id DESC LIMIT ?"))
                .bind(client_id)
                .bind(limite)
                .fetch_all(&pool)
                .await
        }
        None => {
            sqlx::query(&format!("{SQL_VENTES} ORDER BY v.id DESC LIMIT ?"))
                .bind(limite)
                .fetch_all(&pool)
                .await
        }
    }
    .map_err(echec_base)?;

    let resultat = lire_ventes(&pool, lignes).await;
    pool.close().await;
    resultat.map(Json)
}

#[derive(Deserialize)]
pub struct LigneDemandee {
    produit_id: i64,
    quantite: f64,
}

#[derive(Deserialize)]
pub struct VenteDemandee {
    #[serde(default)]
    client_id: Option<i64>,
    mode_paiement: String,
    #[serde(default)]
    montant_recu: Option<f64>,
    /// Confirme une vente à crédit qui dépasse le plafond du client
    #[serde(default)]
    forcer_plafond: bool,
    lignes: Vec<LigneDemandee>,
}

/// Numéro de vente au même format que la caisse du PC : `V` + horodatage en base 36.
fn numero_vente() -> String {
    const CHIFFRES: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut chiffres = Vec::new();
    loop {
        chiffres.push(CHIFFRES[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    chiffres.reverse();
    format!("V{}", String::from_utf8(chiffres).unwrap_or_default())
}

fn format_quantite(q: f64) -> String {
    let texte = format!("{q:.3}");
    texte.trim_end_matches('0').trim_end_matches('.').replace('.', ",")
}

struct LigneValidee {
    produit_id: i64,
    nom: String,
    quantite: f64,
    prix_vente: f64,
    prix_achat: f64,
}

pub async fn creer_vente(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Json(req): Json<VenteDemandee>,
) -> Reponse<VenteMobile> {
    verifier(&ctx, &headers)?;

    let mode = req.mode_paiement.as_str();
    if !matches!(mode, "espece" | "carte" | "credit") {
        return Err(echec(StatusCode::BAD_REQUEST, "paiement", "Moyen de paiement inconnu"));
    }
    if req.lignes.is_empty() {
        return Err(echec(StatusCode::BAD_REQUEST, "panier", "Le panier est vide"));
    }
    if mode == "credit" && req.client_id.is_none() {
        return Err(echec(
            StatusCode::BAD_REQUEST,
            "client",
            "Sélectionnez un client pour une vente à crédit",
        ));
    }

    // Regroupe les lignes d'un même produit (l'ordre du panier est conservé)
    let mut quantites: Vec<(i64, f64)> = Vec::new();
    for l in &req.lignes {
        if !l.quantite.is_finite() || l.quantite <= 0.0 {
            return Err(echec(StatusCode::BAD_REQUEST, "quantite", "Quantité invalide"));
        }
        match quantites.iter_mut().find(|(id, _)| *id == l.produit_id) {
            Some((_, q)) => *q += l.quantite,
            None => quantites.push((l.produit_id, l.quantite)),
        }
    }

    let pool = base(&ctx).await?;
    let mut tx = pool.begin().await.map_err(echec_base)?;

    // Prix et stock lus dans la base du PC : l'iPhone ne fixe jamais les prix
    let mut lignes: Vec<LigneValidee> = Vec::with_capacity(quantites.len());
    for (produit_id, quantite) in quantites {
        let produit = sqlx::query(
            "SELECT nom, prix_vente, prix_achat, stock FROM produits WHERE id = ? AND actif = 1",
        )
        .bind(produit_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(echec_base)?
        .ok_or_else(|| echec(StatusCode::NOT_FOUND, "produit", "Produit introuvable sur le PC"))?;

        let nom: String = produit.try_get("nom").map_err(echec_base)?;
        let stock: f64 = produit.try_get("stock").map_err(echec_base)?;
        if quantite > stock {
            return Err(echec(
                StatusCode::CONFLICT,
                "stock",
                format!("Stock insuffisant pour « {nom} » (disponible : {})", format_quantite(stock)),
            ));
        }
        lignes.push(LigneValidee {
            produit_id,
            nom,
            quantite,
            prix_vente: produit.try_get("prix_vente").map_err(echec_base)?,
            prix_achat: produit.try_get("prix_achat").map_err(echec_base)?,
        });
    }

    let total: f64 = lignes.iter().map(|l| l.quantite * l.prix_vente).sum();

    if let Some(client_id) = req.client_id {
        let client = sqlx::query(&format!("{SQL_CLIENTS} AND c.id = ?"))
            .bind(client_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(echec_base)?
            .ok_or_else(|| echec(StatusCode::NOT_FOUND, "client", "Client introuvable sur le PC"))?;

        let plafond: f64 = client.try_get("plafond_credit").map_err(echec_base)?;
        let dette: f64 = client.try_get("dette").map_err(echec_base)?;
        if mode == "credit" && plafond > 0.0 && dette + total > plafond && !req.forcer_plafond {
            let nom: String = client.try_get("nom").map_err(echec_base)?;
            return Err(echec(
                StatusCode::CONFLICT,
                "plafond",
                format!("Plafond de crédit dépassé pour {nom} ({plafond:.2}). Continuer quand même ?"),
            ));
        }
    }

    // Mêmes montants que la caisse du PC
    let montant_paye = if mode == "credit" { 0.0 } else { total };
    let montant_recu = match mode {
        "espece" => {
            let recu = req.montant_recu.unwrap_or(total);
            if recu + 0.005 < total {
                return Err(echec(
                    StatusCode::BAD_REQUEST,
                    "montant_recu",
                    "Le montant reçu est inférieur au total",
                ));
            }
            recu
        }
        "carte" => total,
        _ => 0.0,
    };

    let numero = numero_vente();
    let vente_id = sqlx::query(
        "INSERT INTO ventes (numero, client_id, montant_total, montant_paye, montant_recu, mode_paiement) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&numero)
    .bind(req.client_id)
    .bind(total)
    .bind(montant_paye)
    .bind(montant_recu)
    .bind(mode)
    .execute(&mut *tx)
    .await
    .map_err(echec_base)?
    .last_insert_rowid();

    for l in &lignes {
        sqlx::query(
            "INSERT INTO lignes_vente (vente_id, produit_id, nom_produit, quantite, prix_unitaire, prix_achat) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(vente_id)
        .bind(l.produit_id)
        .bind(&l.nom)
        .bind(l.quantite)
        .bind(l.prix_vente)
        .bind(l.prix_achat)
        .execute(&mut *tx)
        .await
        .map_err(echec_base)?;

        // La condition sur le stock protège d'une vente faite au même moment sur le PC
        let maj = sqlx::query("UPDATE produits SET stock = stock - ? WHERE id = ? AND stock >= ?")
            .bind(l.quantite)
            .bind(l.produit_id)
            .bind(l.quantite)
            .execute(&mut *tx)
            .await
            .map_err(echec_base)?;
        if maj.rows_affected() != 1 {
            return Err(echec(
                StatusCode::CONFLICT,
                "stock",
                format!("Stock insuffisant pour « {} »", l.nom),
            ));
        }

        sqlx::query(
            "INSERT INTO mouvements_stock (produit_id, type, quantite, motif, reference) VALUES (?, 'vente', ?, ?, ?)",
        )
        .bind(l.produit_id)
        .bind(-l.quantite)
        .bind(format!("Vente {numero}"))
        .bind(&numero)
        .execute(&mut *tx)
        .await
        .map_err(echec_base)?;
    }

    tx.commit().await.map_err(echec_base)?;

    let ligne = sqlx::query(&format!("{SQL_VENTES} AND v.id = ?"))
        .bind(vente_id)
        .fetch_all(&pool)
        .await
        .map_err(echec_base)?;
    let vente = lire_ventes(&pool, ligne).await;
    pool.close().await;

    // La caisse du PC recharge ses produits (stock) et ses clients (dettes)
    let _ = ctx.app.emit(EVT_VENTES_MODIFIEES, ());

    vente?
        .pop()
        .map(Json)
        .ok_or_else(|| echec_base("vente enregistrée mais introuvable"))
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ProduitVendu {
    nom: String,
    quantite: f64,
}

#[derive(Serialize)]
pub struct Statistiques {
    chiffre_affaires_jour: f64,
    chiffre_affaires_total: f64,
    nombre_ventes: i64,
    panier_moyen: f64,
    meilleurs_produits: Vec<ProduitVendu>,
}

pub async fn statistiques(State(ctx): State<Ctx>, headers: HeaderMap) -> Reponse<Statistiques> {
    verifier(&ctx, &headers)?;
    let pool = base(&ctx).await?;

    let totaux = sqlx::query(
        "SELECT CAST(COALESCE(SUM(montant_total), 0) AS REAL) AS total,
                COUNT(*) AS nombre,
                CAST(COALESCE(SUM(CASE WHEN date(cree_le) = date('now', 'localtime') THEN montant_total END), 0) AS REAL) AS jour
           FROM ventes
          WHERE annulee = 0",
    )
    .fetch_one(&pool)
    .await
    .map_err(echec_base)?;

    let meilleurs = sqlx::query(
        "SELECT l.nom_produit AS nom, CAST(SUM(l.quantite) AS REAL) AS quantite
           FROM lignes_vente l
           JOIN ventes v ON v.id = l.vente_id
          WHERE v.annulee = 0
          GROUP BY l.produit_id
          ORDER BY quantite DESC
          LIMIT 5",
    )
    .fetch_all(&pool)
    .await
    .map_err(echec_base)?;
    pool.close().await;

    let total: f64 = totaux.try_get("total").map_err(echec_base)?;
    let nombre: i64 = totaux.try_get("nombre").map_err(echec_base)?;

    Ok(Json(Statistiques {
        chiffre_affaires_jour: totaux.try_get("jour").map_err(echec_base)?,
        chiffre_affaires_total: total,
        nombre_ventes: nombre,
        panier_moyen: if nombre > 0 { total / nombre as f64 } else { 0.0 },
        meilleurs_produits: meilleurs
            .iter()
            .map(|l| -> Result<ProduitVendu, Echec> {
                Ok(ProduitVendu {
                    nom: l.try_get("nom").map_err(echec_base)?,
                    quantite: l.try_get("quantite").map_err(echec_base)?,
                })
            })
            .collect::<Result<Vec<_>, Echec>>()?,
    }))
}
