-- =============================================================================
-- Terminal Portal — initial schema (Neon / plain PostgreSQL 15+)
--
-- Security model
--   * The application connects as the database owner but, inside every request
--     transaction, runs `SET LOCAL ROLE tp_app` — a non-owner role with minimal
--     privileges — so Row Level Security applies to every query it makes.
--   * The caller's credential (raw visitor token and/or admin session token,
--     both read from httpOnly cookies) is placed in transaction-local settings
--     `tp.visitor_token` / `tp.admin_token`. The DATABASE hashes and verifies
--     them; the application never asserts an identity by itself.
--   * Only SHA-256 hashes of tokens are stored. Admin passwords are bcrypt
--     hashes (pgcrypto) that never leave the database.
--   * All writes go through SECURITY DEFINER functions that validate input and
--     enforce ownership, blocked status and rate limits.
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists private;

-- Runtime role used by the web application (RLS applies to it).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tp_app') then
    create role tp_app nologin noinherit;
  end if;
end;
$$;
grant tp_app to current_user;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_status as enum ('active', 'blocked');
create type public.session_status as enum ('active', 'closed');
create type public.sender_type as enum ('user', 'admin', 'system');
create type public.delivery_status as enum ('sent', 'delivered', 'read');
create type public.admin_role as enum ('admin', 'super_admin');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 60),
  email         text not null unique
                check (
                  email = lower(btrim(email))
                  and char_length(email) <= 254
                  and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                ),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default clock_timestamp(),
  status        public.user_status not null default 'active'
);

-- One row per browser identity. token_hash = sha256(hex) of the httpOnly cookie token.
create table public.visitor_access (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id       uuid not null references public.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);

create table public.sessions (
  id                 uuid primary key default gen_random_uuid(),
  session_code       text not null unique check (session_code ~ '^SESS_[A-Z0-9]{6}$'),
  user_id            uuid not null references public.users (id) on delete cascade,
  visitor_access_id  uuid references public.visitor_access (id) on delete set null,
  created_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now(),
  updated_at         timestamptz not null default clock_timestamp(),
  status             public.session_status not null default 'active',
  closed_at          timestamptz,
  -- Maintained by trigger on messages; avoids aggregates in list views.
  message_count      integer not null default 0 check (message_count >= 0),
  unanswered_count   integer not null default 0 check (unanswered_count >= 0)
);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.sessions (id) on delete cascade,
  sender_type      public.sender_type not null,
  content          text not null check (char_length(content) between 1 and 10000),
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default clock_timestamp(),
  delivery_status  public.delivery_status not null default 'sent',
  -- Client-generated idempotency key: a retried submit never creates a duplicate.
  client_msg_id    uuid,
  unique (session_id, client_msg_id)
);

create table public.admin_profiles (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique check (email = lower(btrim(email))),
  password_hash    text not null,
  display_name     text not null check (char_length(display_name) between 1 and 60),
  role             public.admin_role not null default 'admin',
  created_at       timestamptz not null default now(),
  last_login_at    timestamptz,
  failed_attempts  integer not null default 0,
  locked_until     timestamptz
);

create table public.admin_sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  admin_id      uuid not null references public.admin_profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now()
);

-- Internal audit of which administrator wrote which reply. Never visible to visitors.
create table public.admin_reply_log (
  message_id        uuid primary key references public.messages (id) on delete cascade,
  admin_profile_id  uuid references public.admin_profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

create table public.app_config (
  id                     boolean primary key default true check (id),
  message_max_length     integer not null default 2000 check (message_max_length between 100 and 10000),
  rate_limit_per_minute  integer not null default 10 check (rate_limit_per_minute between 1 and 120),
  sessions_per_hour      integer not null default 20 check (sessions_per_hour between 1 and 500),
  updated_at             timestamptz not null default now()
);
insert into public.app_config (id) values (true);

-- -----------------------------------------------------------------------------
-- Indexes (users.email, session_code and token hashes are indexed by UNIQUE)
-- -----------------------------------------------------------------------------
create index users_last_seen_at_idx        on public.users (last_seen_at desc);
create index users_created_at_idx          on public.users (created_at desc);
create index users_updated_at_idx          on public.users (updated_at);
create index visitor_access_user_id_idx    on public.visitor_access (user_id);
create index sessions_user_id_idx          on public.sessions (user_id);
create index sessions_visitor_access_idx   on public.sessions (visitor_access_id);
create index sessions_created_at_idx       on public.sessions (created_at desc);
create index sessions_last_activity_idx    on public.sessions (last_activity_at desc);
create index sessions_updated_at_idx       on public.sessions (updated_at);
create index sessions_unanswered_idx       on public.sessions (last_activity_at desc) where unanswered_count > 0;
create index messages_session_created_idx  on public.messages (session_id, created_at);
create index messages_created_at_idx       on public.messages (created_at desc);
create index messages_updated_at_idx       on public.messages (updated_at);
create index admin_sessions_admin_idx      on public.admin_sessions (admin_id);
create index admin_sessions_expires_idx    on public.admin_sessions (expires_at);
create index admin_reply_log_admin_idx     on public.admin_reply_log (admin_profile_id);

-- -----------------------------------------------------------------------------
-- Private helpers
-- -----------------------------------------------------------------------------
create or replace function private.raise_error(code text, detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Application errors are prefixed "TP:" so the API layer can map them to
  -- safe user-facing messages without leaking internals.
  raise exception using message = 'TP:' || code, detail = coalesce(detail, ''), errcode = 'P0001';
end;
$$;

create or replace function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_token is null or char_length(p_token) < 32 then null
    else encode(pg_catalog.sha256(convert_to(p_token, 'UTF8')), 'hex')
  end;
$$;

create or replace function private.visitor_token_hash()
returns text
language sql
stable
set search_path = ''
as $$
  select private.hash_token(nullif(current_setting('tp.visitor_token', true), ''));
$$;

create or replace function private.current_visitor_access_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select va.id from public.visitor_access va
  where va.token_hash = private.visitor_token_hash()
    and va.revoked_at is null;
$$;

create or replace function private.current_admin_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.admin_id from public.admin_sessions s
  where s.token_hash = private.hash_token(nullif(current_setting('tp.admin_token', true), ''))
    and s.expires_at > now();
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_admin_id() is not null;
$$;

create or replace function private.visitor_owns_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session_id
      and s.visitor_access_id = private.current_visitor_access_id()
  );
$$;

create or replace function private.generate_session_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  bytes bytea;
begin
  loop
    bytes := public.gen_random_bytes(6);
    code := 'SESS_';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.sessions where session_code = code);
  end loop;
  return code;
end;
$$;

create or replace function private.session_json(s public.sessions)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'session_code', s.session_code,
    'created_at', s.created_at,
    'last_activity_at', s.last_activity_at,
    'updated_at', s.updated_at,
    'status', s.status,
    'message_count', s.message_count,
    'unanswered_count', s.unanswered_count
  );
$$;

create or replace function private.message_json(m public.messages)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'session_id', m.session_id,
    'sender_type', m.sender_type,
    'content', m.content,
    'created_at', m.created_at,
    'updated_at', m.updated_at,
    'delivery_status', m.delivery_status,
    'client_msg_id', m.client_msg_id
  );
$$;

-- Normalizes and validates message content against the configured limit.
create or replace function private.clean_message(p_content text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_content text;
  v_max integer;
begin
  select message_max_length into v_max from public.app_config where id;
  v_content := replace(replace(coalesce(p_content, ''), E'\r\n', E'\n'), E'\r', E'\n');
  -- Strip control characters other than newline and tab.
  v_content := regexp_replace(v_content, E'[\\x01-\\x08\\x0B-\\x1F\\x7F]', '', 'g');
  v_content := btrim(v_content, E' \n\t');
  if char_length(v_content) = 0 then
    perform private.raise_error('empty_message');
  end if;
  if char_length(v_content) > v_max then
    perform private.raise_error('message_too_long', v_max::text);
  end if;
  return v_content;
end;
$$;

create or replace function private.create_session(p_user_id uuid, p_visitor_access_id uuid)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_recent integer;
  v_session public.sessions;
begin
  select sessions_per_hour into v_limit from public.app_config where id;
  select count(*) into v_recent
  from public.sessions
  where visitor_access_id = p_visitor_access_id
    and created_at > now() - interval '1 hour';
  if v_recent >= v_limit then
    perform private.raise_error('session_rate_limited', '3600');
  end if;

  insert into public.sessions (session_code, user_id, visitor_access_id)
  values (private.generate_session_code(), p_user_id, p_visitor_access_id)
  returning * into v_session;
  return v_session;
end;
$$;

-- Used by the admin CLI (owner connection only; not granted to tp_app).
create or replace function private.upsert_admin(
  p_email text, p_password text, p_display_name text, p_role public.admin_role
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_password is not null and char_length(p_password) < 10 then
    raise exception 'Password must be at least 10 characters.';
  end if;
  insert into public.admin_profiles (email, password_hash, display_name, role)
  values (
    lower(btrim(p_email)),
    public.crypt(coalesce(p_password, public.gen_random_uuid()::text), public.gen_salt('bf', 12)),
    p_display_name,
    p_role
  )
  on conflict (email) do update set
    password_hash = case when p_password is null then public.admin_profiles.password_hash
                         else excluded.password_hash end,
    display_name = excluded.display_name,
    role = excluded.role,
    failed_attempts = 0,
    locked_until = null
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger users_touch before update on public.users
  for each row execute function private.touch_updated_at();
create trigger sessions_touch before update on public.sessions
  for each row execute function private.touch_updated_at();
create trigger messages_touch before update on public.messages
  for each row execute function private.touch_updated_at();

create or replace function private.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sessions set
    last_activity_at = new.created_at,
    message_count = message_count + 1,
    unanswered_count = case new.sender_type
      when 'user' then unanswered_count + 1
      when 'admin' then 0
      else unanswered_count
    end
  where id = new.session_id;

  if new.sender_type = 'user' then
    update public.users u set last_seen_at = new.created_at
    from public.sessions s
    where s.id = new.session_id and u.id = s.user_id;
  end if;
  return null;
end;
$$;

create trigger messages_after_insert
after insert on public.messages
for each row execute function private.on_message_insert();

-- -----------------------------------------------------------------------------
-- Public (unauthenticated) function
-- -----------------------------------------------------------------------------
create or replace function public.get_public_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'message_max_length', c.message_max_length,
    'rate_limit_per_minute', c.rate_limit_per_minute
  )
  from public.app_config c where c.id;
$$;

-- -----------------------------------------------------------------------------
-- Visitor functions (identity = tp.visitor_token)
-- -----------------------------------------------------------------------------

-- Registers (or reuses) a user by normalized email, links this browser's token
-- to it (creating the access row on first use) and opens a new session.
create or replace function public.visitor_register(p_name text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := private.visitor_token_hash();
  v_name text;
  v_email text;
  v_user public.users;
  v_access public.visitor_access;
  v_session public.sessions;
  v_created boolean;
begin
  if v_hash is null then
    perform private.raise_error('not_authenticated');
  end if;

  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  if char_length(v_name) = 0 or char_length(v_name) > 60 or v_name ~ '[[:cntrl:]]' then
    perform private.raise_error('invalid_name');
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if char_length(v_email) > 254
     or v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    perform private.raise_error('invalid_email');
  end if;

  -- Reuse by unique email. The existing name is intentionally kept: email is
  -- not verified, so a second visitor must not be able to rename a user.
  insert into public.users (name, email)
  values (v_name, v_email)
  on conflict (email) do nothing
  returning * into v_user;
  v_created := found;
  if not v_created then
    update public.users set last_seen_at = now()
    where email = v_email
    returning * into v_user;
  end if;

  if v_user.status = 'blocked' then
    perform private.raise_error('user_blocked');
  end if;

  select * into v_access from public.visitor_access where token_hash = v_hash;
  if found then
    if v_access.revoked_at is not null then
      perform private.raise_error('not_authenticated');
    end if;
    if v_access.user_id <> v_user.id then
      -- This browser token already belongs to another email. The API layer
      -- issues a fresh token and retries, so histories never mix.
      perform private.raise_error('identity_mismatch');
    end if;
    update public.visitor_access set last_seen_at = now() where id = v_access.id;
  else
    insert into public.visitor_access (token_hash, user_id)
    values (v_hash, v_user.id)
    returning * into v_access;
  end if;

  v_session := private.create_session(v_user.id, v_access.id);

  return jsonb_build_object(
    'user', jsonb_build_object('name', v_user.name, 'is_new', v_created),
    'session', private.session_json(v_session)
  );
end;
$$;

-- The caller's linked identity, or null when this browser has none.
create or replace function public.visitor_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('name', u.name, 'email', u.email, 'status', u.status)
  from public.visitor_access va
  join public.users u on u.id = va.user_id
  where va.id = private.current_visitor_access_id();
$$;

create or replace function public.visitor_create_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.visitor_access;
  v_status public.user_status;
  v_session public.sessions;
begin
  select * into v_access from public.visitor_access where id = private.current_visitor_access_id();
  if not found then
    perform private.raise_error('no_access');
  end if;
  select status into v_status from public.users where id = v_access.user_id;
  if v_status = 'blocked' then
    perform private.raise_error('user_blocked');
  end if;
  v_session := private.create_session(v_access.user_id, v_access.id);
  return private.session_json(v_session);
end;
$$;

create or replace function public.visitor_send_message(
  p_session_id uuid,
  p_content text,
  p_client_msg_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.visitor_access;
  v_session public.sessions;
  v_user public.users;
  v_content text;
  v_limit integer;
  v_recent integer;
  v_oldest timestamptz;
  v_existing public.messages;
  v_message public.messages;
begin
  select * into v_access from public.visitor_access where id = private.current_visitor_access_id();
  if not found then
    perform private.raise_error('no_access');
  end if;

  -- Lock the user row: serializes concurrent sends so the rate limit is exact.
  select * into v_user from public.users where id = v_access.user_id for update;
  if v_user.status = 'blocked' then
    perform private.raise_error('user_blocked');
  end if;

  select * into v_session from public.sessions
  where id = p_session_id and visitor_access_id = v_access.id;
  if not found then
    perform private.raise_error('session_not_found');
  end if;
  if v_session.status = 'closed' then
    perform private.raise_error('session_closed');
  end if;

  -- Idempotent retry: return the message already stored for this key.
  if p_client_msg_id is not null then
    select * into v_existing from public.messages
    where session_id = v_session.id and client_msg_id = p_client_msg_id;
    if found then
      return private.message_json(v_existing) || jsonb_build_object('duplicate', true);
    end if;
  end if;

  v_content := private.clean_message(p_content);

  select rate_limit_per_minute into v_limit from public.app_config where id;
  select count(*), min(m.created_at) into v_recent, v_oldest
  from public.messages m
  join public.sessions s on s.id = m.session_id
  where s.user_id = v_user.id
    and m.sender_type = 'user'
    and m.created_at > now() - interval '1 minute';
  if v_recent >= v_limit then
    perform private.raise_error(
      'rate_limited',
      greatest(1, ceil(extract(epoch from (v_oldest + interval '1 minute' - now()))))::int::text
    );
  end if;

  -- Reject an identical message sent to the same session a moment ago.
  if exists (
    select 1 from public.messages
    where session_id = v_session.id
      and sender_type = 'user'
      and content = v_content
      and created_at > now() - interval '5 seconds'
  ) then
    perform private.raise_error('duplicate_message');
  end if;

  insert into public.messages (session_id, sender_type, content, client_msg_id)
  values (v_session.id, 'user', v_content, p_client_msg_id)
  returning * into v_message;

  update public.visitor_access set last_seen_at = now() where id = v_access.id;

  return private.message_json(v_message);
end;
$$;

-- Marks operator replies in one of the caller's sessions as delivered/read.
create or replace function public.visitor_ack(p_session_id uuid, p_status public.delivery_status)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_status = 'sent' then
    perform private.raise_error('invalid_status');
  end if;
  if not private.visitor_owns_session(p_session_id) then
    perform private.raise_error('session_not_found');
  end if;
  update public.messages set delivery_status = p_status
  where session_id = p_session_id
    and sender_type = 'admin'
    and (delivery_status = 'sent' or (p_status = 'read' and delivery_status = 'delivered'));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Revokes this browser's access (visitor "exit").
create or replace function public.visitor_logout()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.visitor_access set revoked_at = now()
  where id = private.current_visitor_access_id();
$$;

-- -----------------------------------------------------------------------------
-- Admin authentication
-- -----------------------------------------------------------------------------

-- Verifies credentials and, on success, stores a session for p_session_token.
-- Five failures lock the account for 15 minutes.
create or replace function public.admin_login(p_email text, p_password text, p_session_token text, p_ttl_hours integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.admin_profiles;
  v_hash text := private.hash_token(p_session_token);
begin
  if v_hash is null then
    perform private.raise_error('invalid_request');
  end if;

  select * into v_admin from public.admin_profiles
  where email = lower(btrim(coalesce(p_email, ''))) for update;

  if not found then
    -- Spend comparable time to avoid revealing which emails exist.
    perform public.crypt(coalesce(p_password, ''), public.gen_salt('bf', 12));
    perform private.raise_error('invalid_credentials');
  end if;

  if v_admin.locked_until is not null and v_admin.locked_until > now() then
    perform private.raise_error(
      'account_locked',
      ceil(extract(epoch from (v_admin.locked_until - now())))::int::text
    );
  end if;

  if v_admin.password_hash <> public.crypt(coalesce(p_password, ''), v_admin.password_hash) then
    update public.admin_profiles set
      failed_attempts = failed_attempts + 1,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
    where id = v_admin.id;
    return jsonb_build_object('error', 'invalid_credentials');
  end if;

  update public.admin_profiles
  set failed_attempts = 0, locked_until = null, last_login_at = now()
  where id = v_admin.id;

  delete from public.admin_sessions where admin_id = v_admin.id and expires_at < now();
  insert into public.admin_sessions (token_hash, admin_id, expires_at)
  values (v_hash, v_admin.id, now() + make_interval(hours => greatest(1, least(p_ttl_hours, 72))));

  return jsonb_build_object(
    'id', v_admin.id,
    'display_name', v_admin.display_name,
    'role', v_admin.role
  );
end;
$$;

create or replace function public.admin_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin public.admin_profiles;
begin
  select * into v_admin from public.admin_profiles where id = private.current_admin_id();
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_admin.id, 'display_name', v_admin.display_name,
    'role', v_admin.role, 'email', v_admin.email
  );
end;
$$;

create or replace function public.admin_logout()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.admin_sessions
  where token_hash = private.hash_token(nullif(current_setting('tp.admin_token', true), ''));
$$;

-- -----------------------------------------------------------------------------
-- Admin operations
-- -----------------------------------------------------------------------------
create or replace function public.admin_send_reply(
  p_session_id uuid,
  p_content text,
  p_client_msg_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := private.current_admin_id();
  v_session public.sessions;
  v_content text;
  v_existing public.messages;
  v_message public.messages;
begin
  if v_admin_id is null then
    perform private.raise_error('forbidden');
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    perform private.raise_error('session_not_found');
  end if;
  if v_session.status = 'closed' then
    perform private.raise_error('session_closed');
  end if;

  if p_client_msg_id is not null then
    select * into v_existing from public.messages
    where session_id = v_session.id and client_msg_id = p_client_msg_id;
    if found then
      return private.message_json(v_existing) || jsonb_build_object('duplicate', true);
    end if;
  end if;

  v_content := private.clean_message(p_content);

  insert into public.messages (session_id, sender_type, content, client_msg_id)
  values (v_session.id, 'admin', v_content, p_client_msg_id)
  returning * into v_message;

  insert into public.admin_reply_log (message_id, admin_profile_id)
  values (v_message.id, v_admin_id);

  update public.messages set delivery_status = 'read'
  where session_id = v_session.id and sender_type = 'user' and delivery_status <> 'read';

  return private.message_json(v_message);
end;
$$;

create or replace function public.admin_mark_session_read(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_admin() then
    perform private.raise_error('forbidden');
  end if;
  update public.messages set delivery_status = 'read'
  where session_id = p_session_id and sender_type = 'user' and delivery_status <> 'read';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_set_session_status(
  p_session_id uuid,
  p_status public.session_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  if not private.is_admin() then
    perform private.raise_error('forbidden');
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    perform private.raise_error('session_not_found');
  end if;
  if v_session.status = p_status then
    return private.session_json(v_session);
  end if;

  update public.sessions
  set status = p_status,
      closed_at = case when p_status = 'closed' then now() else null end
  where id = p_session_id;

  insert into public.messages (session_id, sender_type, content)
  values (
    p_session_id,
    'system',
    case when p_status = 'closed' then 'Session closed. No further transmissions will be accepted on this channel.'
         else 'Session reopened. Channel accepting transmissions.' end
  );

  select * into v_session from public.sessions where id = p_session_id;
  return private.session_json(v_session);
end;
$$;

create or replace function public.admin_stats(p_tz text default 'UTC')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := p_tz;
  v_today timestamptz;
begin
  if not private.is_admin() then
    perform private.raise_error('forbidden');
  end if;
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;
  v_today := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  return jsonb_build_object(
    'total_users',         (select count(*) from public.users),
    'blocked_users',       (select count(*) from public.users where status = 'blocked'),
    'total_sessions',      (select count(*) from public.sessions),
    'active_sessions',     (select count(*) from public.sessions where status = 'active'),
    'unanswered_messages', (select coalesce(sum(unanswered_count), 0) from public.sessions),
    'awaiting_sessions',   (select count(*) from public.sessions where unanswered_count > 0),
    'messages_today',      (select count(*) from public.messages
                            where sender_type = 'user' and created_at >= v_today),
    'recent_activity', coalesce((
      select jsonb_agg(r order by r.created_at desc)
      from (
        select m.id, m.sender_type, left(m.content, 160) as preview, m.created_at,
               s.id as session_id, s.session_code, u.name as user_name, u.email as user_email
        from public.messages m
        join public.sessions s on s.id = m.session_id
        join public.users u on u.id = s.user_id
        order by m.created_at desc
        limit 12
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin list views (security_invoker => underlying RLS applies to the caller)
-- -----------------------------------------------------------------------------
create view public.admin_session_list
with (security_invoker = true) as
select
  s.id, s.session_code, s.user_id, s.created_at, s.last_activity_at, s.updated_at, s.status,
  s.closed_at, s.message_count, s.unanswered_count,
  u.name as user_name, u.email as user_email, u.status as user_status
from public.sessions s
join public.users u on u.id = s.user_id;

create view public.admin_user_list
with (security_invoker = true) as
select
  u.id, u.name, u.email, u.created_at, u.last_seen_at, u.status,
  (select count(*) from public.sessions s where s.user_id = u.id)::int as session_count,
  (select coalesce(sum(s.unanswered_count), 0) from public.sessions s where s.user_id = u.id)::int
    as unanswered_count
from public.users u;

-- -----------------------------------------------------------------------------
-- Row Level Security (applies to tp_app; the owner is only used by migrations)
-- -----------------------------------------------------------------------------
alter table public.users            enable row level security;
alter table public.visitor_access   enable row level security;
alter table public.sessions         enable row level security;
alter table public.messages         enable row level security;
alter table public.admin_profiles   enable row level security;
alter table public.admin_sessions   enable row level security;
alter table public.admin_reply_log  enable row level security;
alter table public.app_config       enable row level security;

-- users: administrators only (visitors read their own profile via visitor_me()).
create policy admins_read_users on public.users
  for select to tp_app using ((select private.is_admin()));
create policy admins_update_users on public.users
  for update to tp_app using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admins_delete_users on public.users
  for delete to tp_app using ((select private.is_admin()));

-- sessions
create policy visitor_reads_own_sessions on public.sessions
  for select to tp_app using (visitor_access_id = (select private.current_visitor_access_id()));
create policy admins_read_sessions on public.sessions
  for select to tp_app using ((select private.is_admin()));
create policy admins_delete_sessions on public.sessions
  for delete to tp_app using ((select private.is_admin()));

-- messages
create policy visitor_reads_own_messages on public.messages
  for select to tp_app using (private.visitor_owns_session(session_id));
create policy admins_read_messages on public.messages
  for select to tp_app using ((select private.is_admin()));

-- admin-only tables
create policy admins_read_profiles on public.admin_profiles
  for select to tp_app using ((select private.is_admin()));
create policy admins_update_own_profile on public.admin_profiles
  for update to tp_app using (id = (select private.current_admin_id())) with check (id = (select private.current_admin_id()));
create policy admins_read_reply_log on public.admin_reply_log
  for select to tp_app using ((select private.is_admin()));
create policy admins_read_config on public.app_config
  for select to tp_app using ((select private.is_admin()));
create policy admins_update_config on public.app_config
  for update to tp_app using ((select private.is_admin())) with check ((select private.is_admin()));
-- visitor_access and admin_sessions: no policies => no direct access at all.

-- -----------------------------------------------------------------------------
-- Privileges for the runtime role
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from public;
revoke all on all functions in schema public from public;
revoke all on all functions in schema private from public;
revoke all on schema private from public;

grant usage on schema public, private to tp_app;
grant execute on function
  private.hash_token(text),
  private.visitor_token_hash(),
  private.current_visitor_access_id(),
  private.current_admin_id(),
  private.is_admin(),
  private.visitor_owns_session(uuid)
to tp_app;

grant select on public.users, public.sessions, public.messages, public.admin_profiles,
               public.admin_reply_log, public.app_config,
               public.admin_session_list, public.admin_user_list
  to tp_app;
grant update (status) on public.users to tp_app;
grant delete on public.users, public.sessions to tp_app;
grant update (display_name) on public.admin_profiles to tp_app;
grant update (message_max_length, rate_limit_per_minute, sessions_per_hour, updated_at)
  on public.app_config to tp_app;

-- pgcrypto functions are only used inside SECURITY DEFINER functions.
revoke execute on all functions in schema public from tp_app;
grant execute on function
  public.get_public_config(),
  public.visitor_register(text, text),
  public.visitor_me(),
  public.visitor_create_session(),
  public.visitor_send_message(uuid, text, uuid),
  public.visitor_ack(uuid, public.delivery_status),
  public.visitor_logout(),
  public.admin_login(text, text, text, integer),
  public.admin_me(),
  public.admin_logout(),
  public.admin_send_reply(uuid, text, uuid),
  public.admin_mark_session_read(uuid),
  public.admin_set_session_status(uuid, public.session_status),
  public.admin_stats(text)
to tp_app;
