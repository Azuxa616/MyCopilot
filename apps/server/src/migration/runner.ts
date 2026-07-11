import type Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS applied_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = db.prepare('SELECT name FROM applied_migrations').all() as { name: string }[];
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    db.exec('BEGIN TRANSACTION');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO applied_migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        Date.now(),
      );
      db.exec('COMMIT');
      console.log(`Migration ${file} applied`);
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(`Migration ${file} failed:`, err);
      throw err;
    }
  }
}
