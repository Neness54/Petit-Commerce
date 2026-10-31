import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:petit-commerce.db");
  }
  return _db;
}

/** Requête SELECT */
export async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

/** Exécution (INSERT/UPDATE/DELETE) — retourne lastInsertId / rowsAffected */
export async function exec(sql: string, params: unknown[] = []): Promise<unknown> {
  const db = await getDb();
  return db.execute(sql, params);
}

/** Exécuteur (soit la base, soit une transaction) */
export interface SqlExecutor {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

export interface Stmt {
  sql: string;
  params?: unknown[];
}

/**
 * Exécute une liste de requêtes dans une transaction SQLite atomique
 * (commande Rust dédiée, car le plugin SQL n'expose pas de transaction).
 * Retourne les last_insert_id de chaque statement.
 */
export async function tx(statements: Stmt[]): Promise<(number | null)[]> {
  const res = await invoke<bigint[] | number[] | null[]>("execute_transaction", {
    statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
  });
  return (res ?? []).map((id) => (id == null ? null : Number(id)));
}

/** Ferme la connexion (avant restauration) */
export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.close();
    _db = null;
  }
}

/** SQL réutilisable : liste des clients avec leur dette actuelle (ventes à crédit - remboursements) */
export const CLIENTS_AVEC_DETTE = `
  SELECT c.*,
    MAX(0,
      COALESCE((SELECT SUM(v.montant_total - v.montant_paye)
                FROM ventes v
                WHERE v.client_id = c.id AND v.mode_paiement = 'credit' AND v.annulee = 0), 0)
      - COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.client_id = c.id), 0)
    ) AS dette
  FROM clients c
  WHERE c.actif = 1
  ORDER BY c.nom COLLATE NOCASE
`;
