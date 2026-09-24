#!/usr/bin/env node
/**
 * Creates or updates an administrator account.
 *
 *   npm run admin:create -- --email you@example.com --password '<min 10 chars>' [--name Operator] [--role super_admin]
 *
 * Omit --password to update name/role of an existing admin without changing it.
 * Connects with DATABASE_URL_UNPOOLED (or DATABASE_URL) as the database owner.
 * The password is hashed with bcrypt inside PostgreSQL (pgcrypto).
 */
import { parseArgs } from "node:util";
import pg from "pg";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    name: { type: "string", default: "Operator" },
    role: { type: "string", default: "super_admin" },
  },
});

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) fail("Set DATABASE_URL_UNPOOLED or DATABASE_URL.");
if (!values.email) fail("--email is required.");
if (!["admin", "super_admin"].includes(values.role)) fail("--role must be admin or super_admin.");
if (values.password !== undefined && values.password.length < 10) fail("--password must be at least 10 characters.");

const client = new pg.Client({ connectionString });
await client.connect();
try {
  if (values.password === undefined) {
    const { rowCount } = await client.query("select 1 from public.admin_profiles where email = lower(btrim($1))", [
      values.email,
    ]);
    if (!rowCount) fail("No such admin; --password is required to create one.");
  }
  await client.query("select private.upsert_admin($1, $2, $3, $4::public.admin_role)", [
    values.email,
    values.password ?? null,
    values.name,
    values.role,
  ]);
  console.log(`✔ ${values.email.trim().toLowerCase()} is an administrator (${values.role}). Sign in at /admin/login.`);
} catch (error) {
  fail(error.message);
} finally {
  await client.end();
}
