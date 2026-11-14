import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

export function openDb(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all()
      .map(row => row.name),
  );

  const files = readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort();

  for (const name of files) {
    if (applied.has(name)) continue;

    const sql = readFileSync(join(migrationsDir, name), 'utf8');

    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
      ).run(name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
