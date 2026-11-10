//! Accès direct à la base SQLite depuis Rust (hors plugin SQL du frontend).
//!
//! La configuration est identique à `execute_transaction` dans `lib.rs` :
//! même fichier, `busy_timeout` de 10 s pour éviter « database is locked »
//! quand l'interface tient déjà une connexion.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::str::FromStr;
use tauri::Manager;

/// Ouvre une connexion courte durée vers la base de l'application.
pub async fn open_pool(app: &tauri::AppHandle) -> Result<SqlitePool, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = dir.join("petit-commerce.db");
    let url = format!("sqlite:{}", path.display());

    let opts = SqliteConnectOptions::from_str(&url)
        .map_err(|e| e.to_string())?
        .create_if_missing(true)
        .busy_timeout(std::time::Duration::from_secs(10));

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())
}

/// Crée la table des appareils si elle n'existe pas encore.
/// Utile car le serveur HTTP peut démarrer avant les migrations du frontend.
pub async fn ensure_appareils_table(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS appareils_mobiles (
            token TEXT PRIMARY KEY,
            nom TEXT NOT NULL,
            cree_le TEXT DEFAULT (datetime('now', 'localtime'))
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
