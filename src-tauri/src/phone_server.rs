//! Serveur HTTP local : scanner téléphone + caisse mobile synchronisée.
//!
//! Toutes les routes `/api/*` (sauf `ping` et `pair`) exigent un jeton :
//! `Authorization: Bearer <jeton>`.
//!
//! Appairage : code à 6 chiffres (validité 5 minutes) affiché sur le PC.

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::Html,
    routing::{get, post},
    Json, Router,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State as TauriState};
use tokio::sync::oneshot;

use crate::db;

/// Port d'écoute du serveur local
pub const PORT: u16 = 8787;
/// Durée de validité du code d'appairage (secondes)
const CODE_TTL: u64 = 300;
/// Délai maximum d'attente de la réponse de l'écran Caisse (secondes)
const SCAN_TIMEOUT: u64 = 4;

/// Expression SQL de la dette d'un client (identique à `CLIENTS_AVEC_DETTE`)
const DETTE_SQL: &str = "CAST(MAX(0,
    CAST(COALESCE((SELECT SUM(v.montant_total - v.montant_paye)
                   FROM ventes v
                   WHERE v.client_id = c.id AND v.mode_paiement = 'credit' AND v.annulee = 0), 0) AS REAL)
    - CAST(COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.client_id = c.id), 0) AS REAL)
  ) AS REAL)";

// ---------------------------------------------------------------------------
// Modèles
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Appareil {
    pub token: String,
    pub nom: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneInfo {
    pub running: bool,
    pub port: u16,
    pub ip: String,
    pub url: String,
    pub code: String,
    pub seconds_left: u64,
    pub qr_svg: Option<String>,
    pub appareils: Vec<Appareil>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReply {
    pub ok: bool,
    pub message: String,
    pub nom: Option<String>,
    pub prix: Option<f64>,
    pub total: f64,
    pub articles: i64,
}

#[derive(Serialize)]
struct ApiError {
    erreur: String,
    code: String,
}

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<ApiError>)>;

fn api_err(status: StatusCode, code: &str, message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    (
        status,
        Json(ApiError {
            erreur: message.into(),
            code: code.to_string(),
        }),
    )
}

#[derive(Serialize)]
struct Commerce {
    nom: String,
    adresse: String,
    telephone: String,
    email: String,
    siret: String,
}

#[derive(Serialize)]
struct SessionRes {
    appareil: String,
    devise: String,
    commerce: Commerce,
}

#[derive(Serialize)]
struct ProduitRes {
    id: i64,
    nom: String,
    code_barres: Option<String>,
    prix_vente: f64,
    stock: f64,
    unite: String,
}

#[derive(Serialize)]
struct ClientRes {
    id: i64,
    nom: String,
    telephone: String,
    email: String,
    adresse: String,
}

#[derive(Serialize)]
struct ClientListeRes {
    id: i64,
    nom: String,
    telephone: String,
    email: String,
    adresse: String,
    plafond_credit: f64,
    dette: f64,
}

#[derive(Serialize)]
struct LigneRes {
    nom: String,
    quantite: f64,
    prix_unitaire: f64,
}

#[derive(Serialize)]
struct VenteRes {
    numero: String,
    date: String,
    mode_paiement: String,
    montant_total: f64,
    montant_paye: f64,
    montant_recu: Option<f64>,
    client: Option<ClientRes>,
    lignes: Vec<LigneRes>,
}

#[derive(Serialize)]
struct MeilleurProduit {
    nom: String,
    quantite: f64,
}

#[derive(Serialize)]
struct StatsRes {
    chiffre_affaires_jour: f64,
    chiffre_affaires_total: f64,
    nombre_ventes: i64,
    panier_moyen: f64,
    meilleurs_produits: Vec<MeilleurProduit>,
}

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

struct Inner {
    code: String,
    expires: Instant,
    appareils: Vec<Appareil>,
    total: f64,
    articles: i64,
    pending: HashMap<String, oneshot::Sender<ScanReply>>,
}

pub struct PhoneState {
    inner: Mutex<Inner>,
}

fn random_code() -> String {
    let n: u32 = rand::thread_rng().gen_range(0..1_000_000);
    format!("{n:06}")
}

fn random_hex(len: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| format!("{:x}", rng.gen_range(0..16)))
        .collect()
}

/// Formate un nombre comme en JS : entier sans décimale, sinon 2 décimaux max.
fn fmt_num(v: f64) -> String {
    if (v.fract()).abs() < 1e-9 {
        format!("{}", v as i64)
    } else {
        let s = format!("{v:.3}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

/// Base 36 majuscule (même format que `Date.now().toString(36).toUpperCase()`)
fn base36(n: u128) -> String {
    const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if n == 0 {
        return "0".to_string();
    }
    let mut v = n;
    let mut out = Vec::new();
    while v > 0 {
        out.push(DIGITS[(v % 36) as usize]);
        v /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_else(|_| "0".to_string())
}

fn new_numero() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("V{}", base36(ms))
}

impl PhoneState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                code: random_code(),
                expires: Instant::now() + Duration::from_secs(CODE_TTL),
                appareils: Vec::new(),
                total: 0.0,
                articles: 0,
                pending: HashMap::new(),
            }),
        }
    }

    fn refresh_code(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.code = random_code();
        inner.expires = Instant::now() + Duration::from_secs(CODE_TTL);
    }

    fn verify_code(&self, code: &str) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.expires > Instant::now() && inner.code == code.trim()
    }

    fn add_appareil(&self, token: String, nom: String) {
        let mut inner = self.inner.lock().unwrap();
        inner.appareils.push(Appareil { token, nom });
    }

    fn set_appareils(&self, appareils: Vec<Appareil>) {
        let mut inner = self.inner.lock().unwrap();
        inner.appareils = appareils;
    }

    fn is_authorized(&self, token: &str) -> bool {
        if token.is_empty() {
            return false;
        }
        let inner = self.inner.lock().unwrap();
        inner.appareils.iter().any(|a| a.token == token)
    }

    fn device_name(&self, token: &str) -> Option<String> {
        let inner = self.inner.lock().unwrap();
        inner
            .appareils
            .iter()
            .find(|a| a.token == token)
            .map(|a| a.nom.clone())
    }

    fn revoke(&self, token: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.appareils.retain(|a| a.token != token);
    }

    fn set_panier(&self, total: f64, articles: i64) {
        let mut inner = self.inner.lock().unwrap();
        inner.total = total;
        inner.articles = articles;
    }

    fn register(&self, id: &str, tx: oneshot::Sender<ScanReply>) {
        let mut inner = self.inner.lock().unwrap();
        inner.pending.insert(id.to_string(), tx);
    }

    fn cancel(&self, id: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.pending.remove(id);
    }

    fn reply(&self, id: &str, reply: ScanReply) {
        let tx = {
            let mut inner = self.inner.lock().unwrap();
            inner.pending.remove(id)
        };
        if let Some(tx) = tx {
            let _ = tx.send(reply);
        }
    }

    fn snapshot(&self) -> (f64, i64, Vec<Appareil>, String, u64) {
        let inner = self.inner.lock().unwrap();
        let left = inner
            .expires
            .saturating_duration_since(Instant::now())
            .as_secs();
        (
            inner.total,
            inner.articles,
            inner.appareils.clone(),
            inner.code.clone(),
            left,
        )
    }
}

pub struct PhoneServer {
    pub state: Arc<PhoneState>,
    running: Mutex<bool>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

impl PhoneServer {
    pub fn new() -> Self {
        Self {
            state: Arc::new(PhoneState::new()),
            running: Mutex::new(false),
            shutdown: Mutex::new(None),
        }
    }

    fn is_running(&self) -> bool {
        *self.running.lock().unwrap()
    }
}

// ---------------------------------------------------------------------------
// Utilitaires réseau
// ---------------------------------------------------------------------------

/// Récupère l'adresse IP locale du PC sur le réseau (sans dépendance externe).
fn local_ip() -> String {
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        // `connect` sur UDP n'envoie aucun paquet : il sert juste à choisir la route
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                if !addr.ip().is_loopback() {
                    return addr.ip().to_string();
                }
            }
        }
    }
    "127.0.0.1".to_string()
}

fn qr_svg(payload: &str) -> Option<String> {
    let code = qrcode::QrCode::new(payload.as_bytes()).ok()?;
    Some(
        code.render::<qrcode::render::svg::Color>()
            .min_dimensions(320, 320)
            .dark_color(qrcode::render::svg::Color("#111827"))
            .light_color(qrcode::render::svg::Color("#ffffff"))
            .build(),
    )
}

fn build_info(server: &PhoneServer) -> PhoneInfo {
    let running = server.is_running();
    let (_, _, appareils, code, seconds_left) = server.state.snapshot();
    let ip = local_ip();
    let url = format!("http://{ip}:{PORT}");
    let qr_svg = if running { qr_svg(&url) } else { None };
    PhoneInfo {
        running,
        port: PORT,
        ip,
        url,
        code,
        seconds_left,
        qr_svg,
        appareils,
    }
}

// ---------------------------------------------------------------------------
// Contexte et authentification
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    phone: Arc<PhoneState>,
}

fn bearer(headers: &HeaderMap) -> String {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("")
        .trim()
        .to_string()
}

fn auth(ctx: &Ctx, headers: &HeaderMap) -> Result<String, (StatusCode, Json<ApiError>)> {
    let token = bearer(headers);
    if ctx.phone.is_authorized(&token) {
        Ok(token)
    } else {
        Err(api_err(
            StatusCode::UNAUTHORIZED,
            "auth",
            "Appareil non autorisé",
        ))
    }
}

async fn pool_or_500(
    ctx: &Ctx,
) -> Result<sqlx::SqlitePool, (StatusCode, Json<ApiError>)> {
    db::open_pool(&ctx.app).await.map_err(|e| {
        api_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "base",
            format!("Base de données indisponible : {e}"),
        )
    })
}

// ---------------------------------------------------------------------------
// Page de test (navigateur)
// ---------------------------------------------------------------------------

async fn page() -> Html<&'static str> {
    Html(r#"<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Petit Commerce — Test scanner</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f8fafc;color:#0f172a}
  h1{font-size:20px;margin:0 0 4px}
  p{color:#475569;font-size:14px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0}
  input{width:100%;padding:12px;font-size:18px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box}
  button{margin-top:10px;width:100%;padding:12px;font-size:16px;font-weight:600;border:0;border-radius:8px;background:#2563eb;color:#fff}
  #log{font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;background:#0f172a;color:#a7f3d0;padding:12px;border-radius:8px;min-height:80px}
</style></head><body>
<h1>Petit Commerce — Scanner</h1>
<p>Page de test : appaire cet appareil puis envoie un code-barres.</p>
<div class="card">
  <label>Code affiché sur le PC</label>
  <input id="code" inputmode="numeric" placeholder="482917">
  <button onclick="pair()">S'appairer</button>
</div>
<div class="card">
  <label>Code-barres</label>
  <input id="bar" placeholder="Scanner ou taper un code" autofocus>
  <button onclick="scan()">Envoyer</button>
</div>
<div id="log">Prêt.</div>
<script>
let token = localStorage.getItem('pc_token') || '';
const log = (m) => { document.getElementById('log').textContent = m; };
if (token) log('Appareil déjà appairé.');
async function pair(){
  const code = document.getElementById('code').value;
  const r = await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,nom:'Navigateur'})});
  const j = await r.json();
  if(j.ok){ token = j.token; localStorage.setItem('pc_token', token); log('Appairé ✔'); }
  else log(j.erreur || 'Code refusé');
}
async function scan(){
  const code = document.getElementById('bar').value.trim();
  if(!code) return;
  const r = await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({code})});
  const j = await r.json();
  if(j.ok) log('✔ '+(j.nom||'')+' — '+j.prix+' €\nPanier : '+j.total+' € ('+j.articles+' art.)');
  else log('✖ '+j.message);
  document.getElementById('bar').value = '';
  document.getElementById('bar').focus();
}
</script></body></html>"#)
}

async fn ping() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "app": "Petit Commerce" }))
}

// ---------------------------------------------------------------------------
// Appairage
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PairReq {
    code: String,
    #[serde(default)]
    nom: Option<String>,
}

#[derive(Serialize)]
struct PairRes {
    ok: bool,
    token: Option<String>,
    erreur: Option<String>,
}

async fn pair(State(ctx): State<Ctx>, Json(req): Json<PairReq>) -> Json<PairRes> {
    if !ctx.phone.verify_code(&req.code) {
        return Json(PairRes {
            ok: false,
            token: None,
            erreur: Some("Code invalide ou expiré".into()),
        });
    }

    let nom = req
        .nom
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Téléphone".to_string());
    let token = random_hex(32);

    // Persiste l'appareil (la caisse mobile doit survivre à un redémarrage)
    if let Ok(pool) = db::open_pool(&ctx.app).await {
        let _ = db::ensure_appareils_table(&pool).await;
        let _ = sqlx::query("INSERT OR REPLACE INTO appareils_mobiles (token, nom) VALUES (?, ?)")
            .bind(&token)
            .bind(&nom)
            .execute(&pool)
            .await;
        pool.close().await;
    }

    ctx.phone.add_appareil(token.clone(), nom);

    Json(PairRes {
        ok: true,
        token: Some(token),
        erreur: None,
    })
}

async fn unpair(State(ctx): State<Ctx>, headers: HeaderMap) -> StatusCode {
    let token = bearer(&headers);
    ctx.phone.revoke(&token);

    if let Ok(pool) = db::open_pool(&ctx.app).await {
        let _ = db::ensure_appareils_table(&pool).await;
        let _ = sqlx::query("DELETE FROM appareils_mobiles WHERE token = ?")
            .bind(&token)
            .execute(&pool)
            .await;
        pool.close().await;
    }
    StatusCode::OK
}

// ---------------------------------------------------------------------------
// Scanner (téléphone -> panier du PC)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ScanReq {
    code: String,
}

async fn scan(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Json(req): Json<ScanReq>,
) -> (StatusCode, Json<ScanReply>) {
    let (total, articles, _, _, _) = ctx.phone.snapshot();

    if !ctx.phone.is_authorized(&bearer(&headers)) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ScanReply {
                ok: false,
                message: "Appareil non autorisé".into(),
                nom: None,
                prix: None,
                total,
                articles,
            }),
        );
    }

    let code = req.code.trim().to_string();
    if code.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ScanReply {
                ok: false,
                message: "Code-barres vide".into(),
                nom: None,
                prix: None,
                total,
                articles,
            }),
        );
    }

    let id = random_hex(12);
    let (tx, rx) = oneshot::channel();
    ctx.phone.register(&id, tx);

    let _ = ctx.app.emit(
        "phone-scan",
        serde_json::json!({ "requestId": id, "code": code }),
    );

    match tokio::time::timeout(Duration::from_secs(SCAN_TIMEOUT), rx).await {
        Ok(Ok(reply)) => (StatusCode::OK, Json(reply)),
        _ => {
            ctx.phone.cancel(&id);
            let (total, articles, _, _, _) = ctx.phone.snapshot();
            (
                StatusCode::REQUEST_TIMEOUT,
                Json(ScanReply {
                    ok: false,
                    message: "Ouvrez l'écran Caisse sur l'ordinateur".into(),
                    nom: None,
                    prix: None,
                    total,
                    articles,
                }),
            )
        }
    }
}

#[derive(Serialize)]
struct EtatRes {
    total: f64,
    articles: i64,
}

async fn etat(State(ctx): State<Ctx>, headers: HeaderMap) -> (StatusCode, Json<EtatRes>) {
    let (total, articles, _, _, _) = ctx.phone.snapshot();
    if !ctx.phone.is_authorized(&bearer(&headers)) {
        return (StatusCode::UNAUTHORIZED, Json(EtatRes { total, articles }));
    }
    (StatusCode::OK, Json(EtatRes { total, articles }))
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

async fn session(State(ctx): State<Ctx>, headers: HeaderMap) -> ApiResult<SessionRes> {
    let token = auth(&ctx, &headers)?;
    let pool = pool_or_500(&ctx).await?;

    let rows = sqlx::query_as::<_, (String, String)>("SELECT cle, valeur FROM parametres")
        .fetch_all(&pool)
        .await
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;
    pool.close().await;

    let params: HashMap<String, String> = rows.into_iter().collect();
    let get = |cle: &str| params.get(cle).cloned().unwrap_or_default();

    let nom_commerce = {
        let v = get("nom_commerce");
        if v.is_empty() {
            "Mon Commerce".to_string()
        } else {
            v
        }
    };
    let ent_nom = get("entreprise_nom");
    let devise = {
        let v = get("devise");
        if v.is_empty() {
            "EUR".to_string()
        } else {
            v
        }
    };

    Ok(Json(SessionRes {
        appareil: ctx
            .phone
            .device_name(&token)
            .unwrap_or_else(|| "Téléphone".into()),
        devise,
        commerce: Commerce {
            nom: if ent_nom.trim().is_empty() {
                nom_commerce
            } else {
                ent_nom
            },
            adresse: get("entreprise_adresse"),
            telephone: get("entreprise_telephone"),
            email: get("entreprise_email"),
            siret: get("entreprise_siret"),
        },
    }))
}

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------

async fn produits(State(ctx): State<Ctx>, headers: HeaderMap) -> ApiResult<Vec<ProduitRes>> {
    auth(&ctx, &headers)?;
    let pool = pool_or_500(&ctx).await?;

    let rows = sqlx::query_as::<_, (i64, String, Option<String>, f64, f64, String)>(
        "SELECT id, nom, code_barres, CAST(prix_vente AS REAL), CAST(stock AS REAL), unite
           FROM produits
          WHERE actif = 1
          ORDER BY nom COLLATE NOCASE",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;
    pool.close().await;

    Ok(Json(
        rows.into_iter()
            .map(|(id, nom, code_barres, prix_vente, stock, unite)| ProduitRes {
                id,
                nom,
                code_barres,
                prix_vente,
                stock,
                unite,
            })
            .collect(),
    ))
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

async fn clients(State(ctx): State<Ctx>, headers: HeaderMap) -> ApiResult<Vec<ClientListeRes>> {
    auth(&ctx, &headers)?;
    let pool = pool_or_500(&ctx).await?;

    let sql = format!(
        "SELECT c.id, c.nom, c.telephone, c.email, c.adresse,
                CAST(c.plafond_credit AS REAL),
                {DETTE_SQL} AS dette
           FROM clients c
          WHERE c.actif = 1
          ORDER BY c.nom COLLATE NOCASE"
    );

    let rows = sqlx::query_as::<
        _,
        (i64, String, Option<String>, Option<String>, Option<String>, f64, f64),
    >(&sql)
    .fetch_all(&pool)
    .await
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;
    pool.close().await;

    Ok(Json(
        rows.into_iter()
            .map(
                |(id, nom, telephone, email, adresse, plafond_credit, dette)| ClientListeRes {
                    id,
                    nom,
                    telephone: telephone.unwrap_or_default(),
                    email: email.unwrap_or_default(),
                    adresse: adresse.unwrap_or_default(),
                    plafond_credit,
                    dette,
                },
            )
            .collect(),
    ))
}

#[derive(Deserialize)]
struct ClientReq {
    #[serde(default)]
    nom: String,
    #[serde(default)]
    telephone: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    adresse: String,
}

fn nullify(v: &str) -> Option<String> {
    let t = v.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

async fn client_creer(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Json(req): Json<ClientReq>,
) -> ApiResult<ClientListeRes> {
    auth(&ctx, &headers)?;

    let nom = req.nom.trim().to_string();
    if nom.is_empty() {
        return Err(api_err(StatusCode::BAD_REQUEST, "nom", "Le nom est obligatoire"));
    }

    let pool = pool_or_500(&ctx).await?;
    let res = sqlx::query(
        "INSERT INTO clients (nom, telephone, email, adresse) VALUES (?, ?, ?, ?)",
    )
    .bind(&nom)
    .bind(nullify(&req.telephone))
    .bind(nullify(&req.email))
    .bind(nullify(&req.adresse))
    .execute(&pool)
    .await
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

    let id = res.last_insert_rowid();
    pool.close().await;

    let _ = ctx.app.emit("ventes-modifiees", serde_json::json!({}));

    Ok(Json(ClientListeRes {
        id,
        nom,
        telephone: req.telephone.trim().to_string(),
        email: req.email.trim().to_string(),
        adresse: req.adresse.trim().to_string(),
        plafond_credit: 0.0,
        dette: 0.0,
    }))
}

// ---------------------------------------------------------------------------
// Ventes
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct VentesQuery {
    #[serde(default)]
    limite: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
}

async fn charger_client(
    pool: &sqlx::SqlitePool,
    id: i64,
) -> Result<Option<ClientRes>, String> {
    let row = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>)>(
        "SELECT id, nom, telephone, email, adresse FROM clients WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|(id, nom, telephone, email, adresse)| ClientRes {
        id,
        nom,
        telephone: telephone.unwrap_or_default(),
        email: email.unwrap_or_default(),
        adresse: adresse.unwrap_or_default(),
    }))
}

async fn charger_lignes(
    pool: &sqlx::SqlitePool,
    vente_id: i64,
) -> Result<Vec<LigneRes>, String> {
    let rows = sqlx::query_as::<_, (String, f64, f64)>(
        "SELECT nom_produit, CAST(quantite AS REAL), CAST(prix_unitaire AS REAL)
           FROM lignes_vente WHERE vente_id = ? ORDER BY id",
    )
    .bind(vente_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(nom, quantite, prix_unitaire)| LigneRes {
            nom,
            quantite,
            prix_unitaire,
        })
        .collect())
}

async fn ventes_liste(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Query(q): Query<VentesQuery>,
) -> ApiResult<Vec<VenteRes>> {
    auth(&ctx, &headers)?;

    let limite = q
        .limite
        .as_deref()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(100)
        .clamp(1, 500);
    let client_id = q
        .client_id
        .as_deref()
        .and_then(|v| v.trim().parse::<i64>().ok());

    let pool = pool_or_500(&ctx).await?;

    let rows = sqlx::query_as::<
        _,
        (i64, String, String, String, f64, f64, Option<f64>, Option<i64>),
    >(
        "SELECT id, numero, cree_le, mode_paiement,
                CAST(montant_total AS REAL), CAST(montant_paye AS REAL),
                CAST(montant_recu AS REAL), client_id
           FROM ventes
          WHERE annulee = 0
            AND (? IS NULL OR client_id = ?)
          ORDER BY cree_le DESC, id DESC
          LIMIT ?",
    )
    .bind(client_id)
    .bind(client_id)
    .bind(limite)
    .fetch_all(&pool)
    .await
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

    let mut out = Vec::with_capacity(rows.len());
    for (id, numero, date, mode_paiement, montant_total, montant_paye, montant_recu, client_id) in rows
    {
        let client = match client_id {
            Some(cid) => charger_client(&pool, cid)
                .await
                .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e))?,
            None => None,
        };
        let lignes = charger_lignes(&pool, id)
            .await
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e))?;

        out.push(VenteRes {
            numero,
            date,
            mode_paiement,
            montant_total,
            montant_paye,
            montant_recu,
            client,
            lignes,
        });
    }

    pool.close().await;
    Ok(Json(out))
}

#[derive(Deserialize)]
struct LigneVenteReq {
    produit_id: i64,
    quantite: f64,
}

#[derive(Deserialize)]
struct VenteReq {
    #[serde(default)]
    client_id: Option<i64>,
    #[serde(default)]
    mode_paiement: String,
    #[serde(default)]
    montant_recu: Option<f64>,
    #[serde(default)]
    forcer_plafond: bool,
    #[serde(default)]
    lignes: Vec<LigneVenteReq>,
}

async fn vente_creer(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Json(req): Json<VenteReq>,
) -> ApiResult<VenteRes> {
    auth(&ctx, &headers)?;

    let mode = req.mode_paiement.trim().to_lowercase();
    if mode != "espece" && mode != "carte" && mode != "credit" {
        return Err(api_err(
            StatusCode::BAD_REQUEST,
            "paiement",
            "Mode de paiement inconnu",
        ));
    }
    if req.lignes.is_empty() {
        return Err(api_err(StatusCode::BAD_REQUEST, "panier", "Le panier est vide"));
    }
    if req.lignes.iter().any(|l| l.quantite <= 0.0) {
        return Err(api_err(
            StatusCode::BAD_REQUEST,
            "quantite",
            "Les quantités doivent être supérieures à zéro",
        ));
    }
    if mode == "credit" && req.client_id.is_none() {
        return Err(api_err(
            StatusCode::BAD_REQUEST,
            "client",
            "Sélectionnez un client pour une vente à crédit",
        ));
    }

    // Regroupe les lignes d'un même produit
    let mut groupees: Vec<(i64, f64)> = Vec::new();
    for l in &req.lignes {
        if let Some(entry) = groupees.iter_mut().find(|(pid, _)| *pid == l.produit_id) {
            entry.1 += l.quantite;
        } else {
            groupees.push((l.produit_id, l.quantite));
        }
    }

    let pool = pool_or_500(&ctx).await?;

    // Produits (jamais de prix venant du téléphone)
    struct P {
        nom: String,
        prix_vente: f64,
        prix_achat: f64,
        stock: f64,
    }
    let mut produits_map: HashMap<i64, P> = HashMap::new();
    for (pid, _) in &groupees {
        let row = sqlx::query_as::<_, (String, f64, f64, f64)>(
            "SELECT nom, CAST(prix_vente AS REAL), CAST(prix_achat AS REAL), CAST(stock AS REAL)
               FROM produits WHERE id = ? AND actif = 1",
        )
        .bind(pid)
        .fetch_optional(&pool)
        .await
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

        match row {
            Some((nom, prix_vente, prix_achat, stock)) => {
                produits_map.insert(*pid, P {
                    nom,
                    prix_vente,
                    prix_achat,
                    stock,
                });
            }
            None => {
                pool.close().await;
                return Err(api_err(
                    StatusCode::NOT_FOUND,
                    "produit",
                    format!("Produit {pid} introuvable"),
                ));
            }
        }
    }

    // Stock suffisant ?
    for (pid, qte) in &groupees {
        if let Some(p) = produits_map.get(pid) {
            if *qte > p.stock {
                let msg = format!(
                    "Stock insuffisant pour « {} » (disponible : {})",
                    p.nom,
                    fmt_num(p.stock)
                );
                pool.close().await;
                return Err(api_err(StatusCode::CONFLICT, "stock", msg));
            }
        }
    }

    let total: f64 = groupees
        .iter()
        .map(|(pid, qte)| qte * produits_map.get(pid).map(|p| p.prix_vente).unwrap_or(0.0))
        .sum();

    // Client + plafond
    let client = match req.client_id {
        Some(cid) => {
            let row = sqlx::query_as::<_, (String, f64, f64)>(
                &format!(
                    "SELECT c.nom, CAST(c.plafond_credit AS REAL), {DETTE_SQL} AS dette
                       FROM clients c WHERE c.id = ?"
                ),
            )
            .bind(cid)
            .fetch_optional(&pool)
            .await
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

            match row {
                Some((nom, plafond, dette)) => {
                    if mode == "credit"
                        && plafond > 0.0
                        && dette + total > plafond
                        && !req.forcer_plafond
                    {
                        let msg = format!(
                            "Plafond de crédit dépassé pour {nom} ({}). Continuer quand même ?",
                            fmt_num(plafond)
                        );
                        pool.close().await;
                        return Err(api_err(StatusCode::CONFLICT, "plafond", msg));
                    }
                    Some(cid)
                }
                None => {
                    pool.close().await;
                    return Err(api_err(
                        StatusCode::NOT_FOUND,
                        "client",
                        "Client introuvable",
                    ));
                }
            }
        }
        None => None,
    };

    // Montants
    let (montant_paye, montant_recu_val) = match mode.as_str() {
        "credit" => (0.0, 0.0),
        "carte" => (total, total),
        _ => {
            let recu = req.montant_recu.unwrap_or(total);
            if recu < total {
                pool.close().await;
                return Err(api_err(
                    StatusCode::BAD_REQUEST,
                    "montant_recu",
                    "Le montant reçu est inférieur au total",
                ));
            }
            (total, recu)
        }
    };

    let numero = new_numero();

    // Transaction atomique
    let mut txf = pool
        .begin()
        .await
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

    let res = sqlx::query(
        "INSERT INTO ventes (numero, client_id, montant_total, montant_paye, montant_recu, mode_paiement)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&numero)
    .bind(client)
    .bind(total)
    .bind(montant_paye)
    .bind(montant_recu_val)
    .bind(&mode)
    .execute(&mut *txf)
    .await;

    let vente_id = match res {
        Ok(r) => r.last_insert_rowid(),
        Err(e) => {
            let _ = txf.rollback().await;
            pool.close().await;
            return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()));
        }
    };

    for (pid, qte) in &groupees {
        let p = match produits_map.get(pid) {
            Some(p) => p,
            None => continue,
        };

        if let Err(e) = sqlx::query(
            "INSERT INTO lignes_vente (vente_id, produit_id, nom_produit, quantite, prix_unitaire, prix_achat)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(vente_id)
        .bind(pid)
        .bind(&p.nom)
        .bind(qte)
        .bind(p.prix_vente)
        .bind(p.prix_achat)
        .execute(&mut *txf)
        .await
        {
            let _ = txf.rollback().await;
            pool.close().await;
            return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()));
        }

        let maj = sqlx::query("UPDATE produits SET stock = stock - ? WHERE id = ? AND stock >= ?")
            .bind(qte)
            .bind(pid)
            .bind(qte)
            .execute(&mut *txf)
            .await;

        let insuffisant = match maj {
            Ok(r) => r.rows_affected() == 0,
            Err(e) => {
                let _ = txf.rollback().await;
                pool.close().await;
                return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()));
            }
        };

        if insuffisant {
            let _ = txf.rollback().await;
            pool.close().await;
            return Err(api_err(
                StatusCode::CONFLICT,
                "stock",
                format!(
                    "Stock insuffisant pour « {} » (disponible : {})",
                    p.nom,
                    fmt_num(p.stock)
                ),
            ));
        }

        let motif = format!("Vente {numero}");
        if let Err(e) = sqlx::query(
            "INSERT INTO mouvements_stock (produit_id, type, quantite, motif, reference)
             VALUES (?, 'vente', ?, ?, ?)",
        )
        .bind(pid)
        .bind(-qte)
        .bind(&motif)
        .bind(&numero)
        .execute(&mut *txf)
        .await
        {
            let _ = txf.rollback().await;
            pool.close().await;
            return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()));
        }
    }

    if let Err(e) = txf.commit().await {
        pool.close().await;
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()));
    }

    // Relit la date réellement enregistrée par SQLite
    let date: String = sqlx::query_scalar::<_, String>("SELECT cree_le FROM ventes WHERE id = ?")
        .bind(vente_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_default();

    pool.close().await;
    let _ = ctx.app.emit("ventes-modifiees", serde_json::json!({}));

    // Réponse : la vente créée
    let client_res = match client {
        Some(cid) => {
            let pool2 = pool_or_500(&ctx).await?;
            let c = charger_client(&pool2, cid)
                .await
                .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e))?;
            pool2.close().await;
            c
        }
        None => None,
    };

    let lignes_res: Vec<LigneRes> = groupees
        .iter()
        .filter_map(|(pid, qte)| {
            produits_map.get(pid).map(|p| LigneRes {
                nom: p.nom.clone(),
                quantite: *qte,
                prix_unitaire: p.prix_vente,
            })
        })
        .collect();

    Ok(Json(VenteRes {
        numero,
        date,
        mode_paiement: mode,
        montant_total: total,
        montant_paye,
        montant_recu: Some(montant_recu_val),
        client: client_res,
        lignes: lignes_res,
    }))
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

async fn statistiques(State(ctx): State<Ctx>, headers: HeaderMap) -> ApiResult<StatsRes> {
    auth(&ctx, &headers)?;
    let pool = pool_or_500(&ctx).await?;

    let total: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT CAST(COALESCE(SUM(montant_total), 0) AS REAL) FROM ventes WHERE annulee = 0",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

    let jour: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT CAST(COALESCE(SUM(montant_total), 0) AS REAL)
           FROM ventes
          WHERE annulee = 0 AND date(cree_le) = date('now', 'localtime')",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

    let nombre: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM ventes WHERE annulee = 0",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

    let meilleurs = sqlx::query_as::<_, (String, f64)>(
        "SELECT lv.nom_produit, CAST(SUM(lv.quantite) AS REAL) AS q
           FROM lignes_vente lv
           JOIN ventes v ON v.id = lv.vente_id
          WHERE v.annulee = 0
          GROUP BY lv.nom_produit
          ORDER BY q DESC
          LIMIT 5",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, "base", e.to_string()))?;

    pool.close().await;

    Ok(Json(StatsRes {
        chiffre_affaires_jour: jour,
        chiffre_affaires_total: total,
        nombre_ventes: nombre,
        panier_moyen: if nombre > 0 { total / nombre as f64 } else { 0.0 },
        meilleurs_produits: meilleurs
            .into_iter()
            .map(|(nom, quantite)| MeilleurProduit { nom, quantite })
            .collect(),
    }))
}

// ---------------------------------------------------------------------------
// Démarrage / arrêt
// ---------------------------------------------------------------------------

async fn serve(
    app: AppHandle,
    state: Arc<PhoneState>,
    shutdown: oneshot::Receiver<()>,
) -> Result<(), String> {
    let ctx = Ctx {
        app,
        phone: state,
    };

    let router = Router::new()
        .route("/", get(page))
        .route("/api/ping", get(ping))
        .route("/api/pair", post(pair))
        .route("/api/scan", post(scan))
        .route("/api/etat", get(etat))
        .route("/api/unpair", post(unpair))
        .route("/api/session", get(session))
        .route("/api/produits", get(produits))
        .route("/api/clients", get(clients).post(client_creer))
        .route("/api/ventes", get(ventes_liste).post(vente_creer))
        .route("/api/statistiques", get(statistiques))
        .with_state(ctx);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", PORT))
        .await
        .map_err(|e| format!("Port {PORT} indisponible : {e}"))?;

    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let _ = shutdown.await;
        })
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Commandes Tauri
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn phone_start(
    app: AppHandle,
    server: TauriState<'_, Arc<PhoneServer>>,
) -> Result<PhoneInfo, String> {
    let srv = server.inner().clone();
    start(app, srv).await
}

/// Démarre le serveur local (réutilisable hors commande Tauri, pour les tests)
pub async fn start(app: AppHandle, srv: Arc<PhoneServer>) -> Result<PhoneInfo, String> {
    if srv.is_running() {
        return Ok(build_info(&srv));
    }

    // Recharge les appareils appairés depuis la base
    match db::open_pool(&app).await {
        Ok(pool) => {
            let _ = db::ensure_appareils_table(&pool).await;
            if let Ok(rows) =
                sqlx::query_as::<_, (String, String)>(
                    "SELECT token, nom FROM appareils_mobiles ORDER BY cree_le",
                )
                .fetch_all(&pool)
                .await
            {
                srv.state.set_appareils(
                    rows.into_iter()
                        .map(|(token, nom)| Appareil { token, nom })
                        .collect(),
                );
            }
            pool.close().await;
        }
        Err(e) => eprintln!("[scanner] base indisponible : {e}"),
    }

    let (tx, rx) = oneshot::channel();
    {
        let mut g = srv.shutdown.lock().unwrap();
        *g = Some(tx);
    }
    {
        let mut r = srv.running.lock().unwrap();
        *r = true;
    }

    let state = srv.state.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(app2, state, rx).await {
            eprintln!("[scanner] serveur arrêté : {e}");
        }
    });

    tokio::time::sleep(Duration::from_millis(200)).await;

    let info = build_info(&srv);
    if std::env::var("PC_SCANNER_AUTOSTART").ok().as_deref() == Some("1") {
        eprintln!(
            "[scanner] {} — code d'appairage : {}",
            info.url, info.code
        );
    }
    Ok(info)
}

#[tauri::command]
pub fn phone_stop(server: TauriState<'_, Arc<PhoneServer>>) -> PhoneInfo {
    let srv = server.inner().clone();
    {
        let mut g = srv.shutdown.lock().unwrap();
        if let Some(tx) = g.take() {
            let _ = tx.send(());
        }
    }
    {
        let mut r = srv.running.lock().unwrap();
        *r = false;
    }
    build_info(&srv)
}

#[tauri::command]
pub fn phone_info(server: TauriState<'_, Arc<PhoneServer>>) -> PhoneInfo {
    build_info(server.inner())
}

#[tauri::command]
pub fn phone_new_code(server: TauriState<'_, Arc<PhoneServer>>) -> PhoneInfo {
    let srv = server.inner().clone();
    srv.state.refresh_code();
    build_info(&srv)
}

#[tauri::command]
pub async fn phone_revoke(
    token: String,
    app: AppHandle,
    server: TauriState<'_, Arc<PhoneServer>>,
) -> Result<PhoneInfo, String> {
    let srv = server.inner().clone();
    srv.state.revoke(&token);

    if let Ok(pool) = db::open_pool(&app).await {
        let _ = db::ensure_appareils_table(&pool).await;
        let _ = sqlx::query("DELETE FROM appareils_mobiles WHERE token = ?")
            .bind(&token)
            .execute(&pool)
            .await;
        pool.close().await;
    }
    Ok(build_info(&srv))
}

#[tauri::command]
pub fn phone_set_panier(
    total: f64,
    articles: i64,
    server: TauriState<'_, Arc<PhoneServer>>,
) {
    server.state.set_panier(total, articles);
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn phone_scan_reply(
    request_id: String,
    ok: bool,
    message: String,
    nom: Option<String>,
    prix: Option<f64>,
    total: f64,
    articles: i64,
    server: TauriState<'_, Arc<PhoneServer>>,
) {
    server.state.reply(
        &request_id,
        ScanReply {
            ok,
            message,
            nom,
            prix,
            total,
            articles,
        },
    );
}
