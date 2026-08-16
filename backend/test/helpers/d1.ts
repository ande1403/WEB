import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Náhrada D1 nad better-sqlite3 pro testy.
 * D1 je SQLite, takže se stejným SQL i stejnými `?` parametry — testy tedy ověřují
 * skutečné dotazy, ne jejich zjednodušenou nápodobu.
 */

const here = dirname(fileURLToPath(import.meta.url));

function normalize(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

class Stmt {
  private args: unknown[] = [];
  constructor(
    private db: Database.Database,
    private sql: string
  ) {}

  bind(...args: unknown[]): Stmt {
    this.args = args.map(normalize);
    return this;
  }

  async run(): Promise<{ success: boolean; meta: { last_row_id: number; changes: number } }> {
    const info = this.db.prepare(this.sql).run(...(this.args as never[]));
    return {
      success: true,
      meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes },
    };
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[] };
  }

  async first<T = unknown>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.args as never[])) as T) ?? null;
  }
}

export class FakeD1 {
  readonly db: Database.Database;
  constructor() {
    this.db = new Database(':memory:');
    this.db.exec(readFileSync(join(here, '..', '..', 'migrations', '0001_init.sql'), 'utf8'));
  }
  prepare(sql: string): Stmt {
    return new Stmt(this.db, sql);
  }
  dump(table: string): Record<string, unknown>[] {
    return this.db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  }
}
