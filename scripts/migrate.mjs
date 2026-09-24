#!/usr/bin/env node
/**
 * Applies SQL files in db/migrations (sorted by name) that have not run yet.
 * Each file runs in its own transaction and is recorded in public.schema_migrations.
 *
 *   npm run db:migrate                  # uses DATABASE_URL_UNPOOLED, else DATABASE_URL
 *   node scripts/migrate.mjs <url>      # explicit connection string
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const connectionString = process.argv[2] ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error("✖ Set DATABASE_URL_UNPOOLED or DATABASE_URL (see .env.example).");
  process.exit(1);
}

export async function migrate(url, { log = console.log } = {}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`);
    await client.query("revoke all on public.schema_migrations from public");
    const { rows } = await client.query("select version from public.schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      log(`• applying ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public.schema_migrations (version) values ($1)", [file]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`${file}: ${error.message}`);
      }
      count++;
    }
    log(count ? `✔ applied ${count} migration(s)` : "✔ database is up to date");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate(connectionString).catch((error) => {
    console.error(`✖ migration failed: ${error.message}`);
    process.exit(1);
  });
}
