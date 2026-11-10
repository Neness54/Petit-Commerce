use serde::Deserialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod db;
mod phone_server;

/// Chemin du fichier de base de données
#[tauri::command]
fn database_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("petit-commerce.db").to_string_lossy().to_string())
}

/// Un couple (requête, paramètres) passé à la transaction.
#[derive(Deserialize)]
struct Stmt {
    sql: String,
    #[serde(default)]
    params: Vec<serde_json::Value>,
}

/// Exécute plusieurs requêtes dans une transaction SQLite atomique.
/// Retourne la liste des last_insert_id de chaque statement.
#[tauri::command]
async fn execute_transaction(
    app: tauri::AppHandle,
    statements: Vec<Stmt>,
) -> Result<Vec<i64>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = dir.join("petit-commerce.db");
    let url = format!("sqlite:{}", path.display());

    let opts = SqliteConnectOptions::from_str(&url)
        .map_err(|e| e.to_string())?
        .create_if_missing(true)
        // Attente si le plugin SQL tient la base (évite « database is locked »)
        .busy_timeout(std::time::Duration::from_secs(10));

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut ids = Vec::new();

    for s in &statements {
        let mut query = sqlx::query(&s.sql);
        for p in &s.params {
            query = match p {
                serde_json::Value::Null => query.bind(Option::<String>::None),
                serde_json::Value::Bool(b) => query.bind(*b),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        query.bind(i)
                    } else {
                        query.bind(n.as_f64().unwrap_or(0.0))
                    }
                }
                serde_json::Value::String(str_) => query.bind(str_.clone()),
                other => query.bind(other.to_string()),
            };
        }
        let res = query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
        ids.push(res.last_insert_rowid());
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    pool.close().await;
    Ok(ids)
}

/// Restaure une sauvegarde : copie le fichier choisi par-dessus la base actuelle.
/// Le frontend ferme d'abord la connexion SQL (db.close()) avant d'appeler cette commande,
/// puis redémarre l'application.
#[tauri::command]
fn restore_database(app: tauri::AppHandle, src: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let dest = dir.join("petit-commerce.db");
    std::fs::copy(&src, &dest).map_err(|e| format!("Copie impossible : {e}"))?;
    // Supprimer les fichiers WAL/SHM pour forcer la lecture du fichier restauré
    let _ = std::fs::remove_file(dir.join("petit-commerce.db-wal"));
    let _ = std::fs::remove_file(dir.join("petit-commerce.db-shm"));
    Ok(())
}

pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "schema_initial",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "categories_unite_defaut",
            sql: include_str!("../migrations/002_categories_unite.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "produits_poids",
            sql: include_str!("../migrations/003_produits_poids.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "facturation",
            sql: include_str!("../migrations/004_facturation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "sous_categories_etiquettes",
            sql: include_str!("../migrations/005_sous_categories_etiquettes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "entreprise_facture",
            sql: include_str!("../migrations/006_entreprise_facture.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "appareils_mobiles",
            sql: include_str!("../migrations/007_appareils_mobiles.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:petit-commerce.db", migrations)
                .build(),
        )
        .setup(|app| {
            // Serveur local pour le scanner téléphone (démarré à la demande)
            app.manage(Arc::new(phone_server::PhoneServer::new()));

            // Démarrage automatique pour les tests (PC_SCANNER_AUTOSTART=1)
            if std::env::var("PC_SCANNER_AUTOSTART").ok().as_deref() == Some("1") {
                let handle = app.handle().clone();
                let srv = app
                    .state::<Arc<phone_server::PhoneServer>>()
                    .inner()
                    .clone();
                tauri::async_runtime::spawn(async move {
                    let _ = phone_server::start(handle, srv).await;
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database_path,
            restore_database,
            execute_transaction,
            phone_server::phone_start,
            phone_server::phone_stop,
            phone_server::phone_info,
            phone_server::phone_new_code,
            phone_server::phone_revoke,
            phone_server::phone_set_panier,
            phone_server::phone_scan_reply
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
