/**
 * Migration test: pre-`n_samples` schema → current schema.
 *
 * Applies migration 0000 (the schema that predates federated metadata), writes
 * rows against it, then applies 0001 and 0002 in journal order and checks that
 * the new columns exist with the documented defaults and that pre-existing data
 * survives. Everything runs inside a throwaway PostgreSQL schema and is rolled
 * back, so it is safe against a development database.
 *
 * Requires PostgreSQL. Set TEST_DATABASE_URL (preferred) or DATABASE_URL; when
 * neither points at a reachable server the test reports itself as skipped
 * rather than passing silently.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Minimal structural view of node-postgres, so this test needs no `@types/pg`
 * dependency for a driver the service already ships transitively.
 */
interface PgClient {
  connect(): Promise<void>;
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}
interface PgModule {
  Client: new (config: { connectionString: string; connectionTimeoutMillis?: number }) => PgClient;
}

const pg = createRequire(import.meta.url)("pg") as PgModule;

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/database/drizzle",
);

const CONNECTION_STRING = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? "";
const TEST_SCHEMA = "migration_test_pre_n_samples";

interface JournalEntry { idx: number; tag: string }

async function readJournalTags(): Promise<string[]> {
  const journal = JSON.parse(
    await readFile(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
}

async function readMigration(tag: string): Promise<string[]> {
  const sql = await readFile(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Rebinds a migration statement to the throwaway schema.
 *
 * Drizzle emits `CREATE TABLE` unqualified but writes foreign-key targets as
 * `"public"."users"` — see 0000's closing ALTER TABLE. Under the `search_path`
 * isolation this test relies on, the tables land in `TEST_SCHEMA` while the
 * reference still points at `public`, so the constraint fails with
 * `relation "public.users" does not exist` on any database that has no public
 * schema of its own. That is every fresh CI Postgres.
 *
 * Rewriting the qualifier here keeps the migration files untouched — they are
 * applied history and must not be edited — while letting the sandbox be a
 * faithful, self-contained copy of the real schema.
 */
function intoTestSchema(statement: string): string {
  return statement.replaceAll('"public".', `"${TEST_SCHEMA}".`);
}

async function connect(): Promise<PgClient | null> {
  if (!CONNECTION_STRING) return null;
  const client = new pg.Client({ connectionString: CONNECTION_STRING, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => {});
    return null;
  }
}

async function columnsOf(client: PgClient, table: string): Promise<Map<string, { def: string | null; nullable: string }>> {
  const { rows } = await client.query<{ column_name: string; column_default: string | null; is_nullable: string }>(
    `SELECT column_name, column_default, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2`,
    [TEST_SCHEMA, table],
  );
  return new Map(rows.map((r) => [r.column_name, { def: r.column_default, nullable: r.is_nullable }]));
}

test("the journal lists every migration in order and each file exists", async () => {
  const tags = await readJournalTags();
  assert.deepEqual(tags, ["0000_smiling_firebird", "0001_add_n_samples", "0002_dear_puck"]);
  for (const tag of tags) {
    assert.ok((await readMigration(tag)).length > 0, `${tag}.sql must contain statements`);
  }
});

test("migrating a populated pre-n_samples database preserves data and applies defaults", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip(
      "No reachable PostgreSQL. Run `bun run db:start`, then set TEST_DATABASE_URL "
      + "(or DATABASE_URL) to exercise this test.",
    );
    return;
  }

  try {
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await client.query(`SET search_path TO ${TEST_SCHEMA}`);

    // ── Old world: schema 0000 only ──────────────────────────────────────────
    for (const statement of await readMigration("0000_smiling_firebird")) {
      await client.query(intoTestSchema(statement));
    }

    const beforeColumns = await columnsOf(client, "usermodelhistory");
    assert.equal(beforeColumns.has("n_samples"), false, "0000 must predate n_samples");
    assert.equal(beforeColumns.has("feature_version"), false, "0000 must predate the model contract columns");

    await client.query(
      `INSERT INTO users (userid, username, email, password) VALUES (1, 'legacy', 'legacy@example.com', 'hash')`,
    );
    await client.query(
      `INSERT INTO usermodelhistory (serialno, userid, coeff, intercept)
       VALUES (1, 1, $1::jsonb, $2::jsonb)`,
      [JSON.stringify([[0.1, 0.2]]), JSON.stringify([0.3])],
    );
    await client.query(
      `INSERT INTO globalmodelhistory (serialno, coeff, intercept) VALUES (1, $1::jsonb, $2::jsonb)`,
      [JSON.stringify([[0.4, 0.5]]), JSON.stringify([0.6])],
    );

    // The seed rows above set `serialno` explicitly, which does not advance the
    // `serial` sequence — so the first insert that lets the sequence assign an
    // id would collide on the primary key. Restoring the sequences is what a
    // real restore-then-migrate does, and it is what makes the current-contract
    // insert at the end of this test a meaningful check rather than a crash.
    for (const table of ["users", "usermodelhistory", "globalmodelhistory"]) {
      const column = table === "users" ? "userid" : "serialno";
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence('${TEST_SCHEMA}.${table}', '${column}'),
           (SELECT COALESCE(MAX(${column}), 1) FROM ${table})
         )`,
      );
    }

    // ── Apply the remaining migrations in journal order ──────────────────────
    for (const tag of (await readJournalTags()).slice(1)) {
      for (const statement of await readMigration(tag)) {
        await client.query(intoTestSchema(statement));
      }
    }

    // ── New world: columns, defaults, and back-filled legacy rows ────────────
    const userColumns = await columnsOf(client, "usermodelhistory");
    for (const column of ["n_samples", "feature_version", "scaler_version", "model_version", "validation_auc"]) {
      assert.ok(userColumns.has(column), `usermodelhistory.${column} must exist after migration`);
    }
    assert.equal(userColumns.get("n_samples")!.nullable, "NO", "n_samples must be NOT NULL");
    assert.ok(userColumns.get("n_samples")!.def?.startsWith("1"), "n_samples must default to 1");
    assert.equal(userColumns.get("validation_auc")!.nullable, "YES", "validation_auc is optional");

    const globalColumns = await columnsOf(client, "globalmodelhistory");
    for (const column of ["participants", "n_samples_total", "feature_version", "scaler_version", "model_version"]) {
      assert.ok(globalColumns.has(column), `globalmodelhistory.${column} must exist after migration`);
    }

    const { rows: userRows } = await client.query(
      `SELECT coeff, intercept, n_samples, feature_version, scaler_version, model_version, validation_auc
         FROM usermodelhistory WHERE serialno = 1`,
    );
    assert.equal(userRows.length, 1, "the legacy user row must survive the migration");
    const legacy = userRows[0]!;
    assert.deepEqual(legacy["coeff"], [[0.1, 0.2]]);
    assert.deepEqual(legacy["intercept"], [0.3]);
    assert.equal(legacy["n_samples"], 1, "a pre-existing row is back-filled with the neutral FedAvg weight");
    assert.equal(legacy["feature_version"], 1);
    assert.equal(legacy["scaler_version"], 1);
    assert.equal(legacy["model_version"], 1);
    assert.equal(legacy["validation_auc"], null);

    const { rows: globalRows } = await client.query(
      `SELECT participants, n_samples_total, feature_version FROM globalmodelhistory WHERE serialno = 1`,
    );
    assert.equal(globalRows[0]!["participants"], 0);
    assert.equal(globalRows[0]!["n_samples_total"], 0);
    assert.equal(globalRows[0]!["feature_version"], 1);

    // ── Migrated schema accepts a current-contract insert ────────────────────
    await client.query(
      `INSERT INTO usermodelhistory (userid, coeff, intercept, n_samples, feature_version, scaler_version, model_version, validation_auc)
       VALUES (1, $1::jsonb, $2::jsonb, 250, 1, 1, 1, 0.72)`,
      [JSON.stringify([Array(12).fill(0.1)]), JSON.stringify([0.05])],
    );
    const { rows: inserted } = await client.query(
      `SELECT n_samples, validation_auc FROM usermodelhistory WHERE n_samples = 250`,
    );
    assert.equal(inserted.length, 1);
    assert.ok(Math.abs(Number(inserted[0]!["validation_auc"]) - 0.72) < 1e-6);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).catch(() => {});
    await client.end().catch(() => {});
  }
});
