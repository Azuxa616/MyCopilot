import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../migration/runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

// verbatimModuleSyntax: Database is a namespace-merged value, use InstanceType for type
let db: InstanceType<typeof Database> | null = null;

export function initDatabase(dataDir: string): InstanceType<typeof Database> {
  if (db) {
    db.close();
    db = null;
  }

  const dbPath = join(dataDir, 'my-copilot.db');
  db = new Database(dbPath);

  // Enable WAL mode and foreign keys before running schema
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Execute schema (IF NOT EXISTS ensures idempotency)
  db.exec(schemaSql);

  // Insert initial schema_version if not present
  const row = db
    .prepare("SELECT value FROM config WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO config (key, value) VALUES ('schema_version', '1')").run();
  }

  // Run migrations after baseline schema
  const migrationsDir = join(__dirname, '..', 'migration', 'sql');
  runMigrations(db, migrationsDir);

  return db;
}

export function getDb(): InstanceType<typeof Database> {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}
