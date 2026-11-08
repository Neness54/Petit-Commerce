//! Serveur HTTP local qui permet à un téléphone (sur le même réseau WiFi)
//! d'envoyer des codes-barres à l'application.
//!
//! Sécurité : appairage par code à 6 chiffres (validité 5 minutes), puis token
//! propre à chaque appareil. Aucun accès sans token.

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Html,
    routing::{get, post},
    Json, Router,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State as TauriState};
use tokio::sync::oneshot;

/// Port d'écoute du serveur local
pub const PORT: u16 = 8787;
/// Durée de validité du code d'appairage (secondes)
const CODE_TTL: u64 = 300;
/// Délai maximum d'attente de la réponse de l'écran Caisse (secondes)
const SCAN_TIMEOUT: u64 = 4;

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

    fn issue_token(&self, nom: String) -> String {
        let token = random_hex(32);
        let mut inner = self.inner.lock().unwrap();
        inner.appareils.push(Appareil {
            token: token.clone(),
            nom,
        });
        token
    }

    fn is_authorized(&self, token: &str) -> bool {
        if token.is_empty() {
            return false;
        }
        let inner = self.inner.lock().unwrap();
        inner.appareils.iter().any(|a| a.token == token)
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
    let qr_svg = if running {
        // Le QR contient l'adresse du serveur : scanné avec l'appareil photo,
        // il ouvre directement la page d'appairage sur le téléphone.
        qr_svg(&url)
    } else {
        None
    };
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
  if(j.ok) log('✔ '+(j.nom||'')+' — '+j.prix+' €\\nPanier : '+j.total+' € ('+j.articles+' art.)');
  else log('✖ '+j.message);
  document.getElementById('bar').value = '';
  document.getElementById('bar').focus();
}
</script></body></html>"#)
}

async fn ping() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "app": "Petit Commerce" }))
}

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
    let nom = req.nom.unwrap_or_else(|| "Téléphone".into());
    let token = ctx.phone.issue_token(nom);
    Json(PairRes {
        ok: true,
        token: Some(token),
        erreur: None,
    })
}

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

async fn unpair(State(ctx): State<Ctx>, headers: HeaderMap) -> StatusCode {
    ctx.phone.revoke(&bearer(&headers));
    StatusCode::OK
}

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
// Commandes appelées depuis l'interface
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

    // Laisse au serveur le temps de se lier au port
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
pub fn phone_revoke(
    token: String,
    server: TauriState<'_, Arc<PhoneServer>>,
) -> PhoneInfo {
    let srv = server.inner().clone();
    srv.state.revoke(&token);
    build_info(&srv)
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
