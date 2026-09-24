#!/usr/bin/env node
/**
 * Hardening step (recommended for production): lets the restricted `tp_app`
 * role log in with a freshly generated password and prints a runtime
 * DATABASE_URL that uses it. With the app connecting as tp_app instead of the
 * owner, Row Level Security is a hard boundary — the runtime connection has no
 * owner privileges to fall back to, even under a hypothetical SQL injection.
 *
 *   npm run db:app-role
 *
 * Re-running rotates the password. Update DATABASE_URL in Vercel afterwards.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";

const adminUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const pooledUrl = process.env.DATABASE_URL ?? adminUrl;
if (!adminUrl) {
  console.error("✖ Set DATABASE_URL_UNPOOLED (owner connection).");
  process.exit(1);
}

const password = randomBytes(24).toString("base64url");
const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const { rowCount } = await client.query("select 1 from pg_roles where rolname = 'tp_app'");
  if (!rowCount) throw new Error("Role tp_app does not exist. Run `npm run db:migrate` first.");
  await client.query(`alter role tp_app with login password '${password}'`);
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(1);
} finally {
  await client.end();
}

const url = new URL(pooledUrl);
url.username = "tp_app";
url.password = password;
console.log("✔ tp_app can now log in. Use this as the runtime DATABASE_URL (keep it secret):\n");
console.log(url.toString());
console.log("\nKeep DATABASE_URL_UNPOOLED as the owner connection for migrations and admin:create.");
