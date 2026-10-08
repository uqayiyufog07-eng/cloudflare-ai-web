/**
 * In-memory test double for the Cloudflare D1 binding.
 *
 * It executes the real migration SQL and real queries through bun:sqlite, so
 * tests get genuine SQL semantics (indexes, constraints, ordering) instead of
 * a hand-written mock. Only the small surface of the D1 API used by the app
 * is implemented: prepare/bind/all/run/first and atomic batch().
 */

import { Database } from "bun:sqlite";

export interface FakeD1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

/** Loose structural view of a bun:sqlite statement so unknown[] binds type-check. */
interface LooseSqliteStatement {
  all(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

const loosen = (sqlite: Database, sql: string): LooseSqliteStatement =>
  sqlite.prepare(sql) as unknown as LooseSqliteStatement;

class FakePreparedStatement {
  constructor(
    private readonly sqlite: Database,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): FakePreparedStatement {
    return new FakePreparedStatement(this.sqlite, this.sql, params);
  }

  async all<T = Record<string, unknown>>(): Promise<FakeD1Result<T>> {
    const results = loosen(this.sqlite, this.sql).all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (loosen(this.sqlite, this.sql).get(...this.params) as T | null) ?? null;
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const result = loosen(this.sqlite, this.sql).run(...this.params) as { changes: number | bigint };
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  /** Statements handed to batch() execute as write statements in one transaction. */
  runInBatch(): number {
    const result = loosen(this.sqlite, this.sql).run(...this.params) as {
      changes: number | bigint;
    };
    return Number(result.changes);
  }
}

export class FakeD1 {
  private readonly sqlite: Database;

  constructor(schemaSql: string) {
    this.sqlite = new Database(":memory:");
    this.sqlite.exec(schemaSql);
  }

  prepare(sql: string): FakePreparedStatement {
    return new FakePreparedStatement(this.sqlite, sql);
  }

  async batch(
    statements: FakePreparedStatement[],
  ): Promise<Array<{ success: boolean; meta: { changes: number } }>> {
    const changes: number[] = [];
    const runAll = this.sqlite.transaction((items: FakePreparedStatement[]) => {
      for (const statement of items) {
        changes.push(statement.runInBatch());
      }
    });
    runAll(statements);
    return changes.map((value) => ({ success: true, meta: { changes: value } }));
  }

  /** Test-only escape hatch for seeding rows that real APIs would never write. */
  executeRaw(sql: string, ...params: unknown[]): void {
    loosen(this.sqlite, sql).run(...params);
  }
}

/** The production migration SQL, applied verbatim against every FakeD1 instance. */
export const loadConversationSchema = async (): Promise<string> =>
  Bun.file(new URL("../../migrations/0001_conversations.sql", import.meta.url)).text();
