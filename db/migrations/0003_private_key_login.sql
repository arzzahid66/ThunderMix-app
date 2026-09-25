-- =============================================================================
-- Private-key login.
--
-- Visitors no longer register with name + email. An administrator creates a
-- user and receives a random 64-character hex key exactly once; only its
-- SHA-256 hash (private.hash_token) is stored. The visitor enters that key to
-- sign in. Regenerating a key revokes every browser linked to the old one.
--
-- All existing users (and, by cascade, their sessions and messages) are
-- removed: email identities cannot be converted into keys.
-- =============================================================================

delete from public.users;

-- Objects that reference users.email.
drop view public.admin_session_list;
drop view public.admin_user_list;
drop function public.visitor_register(text, text);

alter table public.users drop column email;
alter table public.users
  add column access_key_hash text not null unique check (access_key_hash ~ '^[0-9a-f]{64}$'),
  add column key_hint text not null check (key_hint ~ '^[0-9a-f]{4}$');

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------
create view public.admin_session_list
with (security_invoker = true) as
select
  s.id, s.session_code, s.user_id, s.created_at, s.last_activity_at, s.updated_at, s.status,
  s.closed_at, s.message_count, s.unanswered_count,
  u.name as user_name, u.key_hint as user_key_hint, u.status as user_status,
  s.visitor_hidden_at
from public.sessions s
join public.users u on u.id = s.user_id;

create view public.admin_user_list
with (security_invoker = true) as
select
  u.id, u.name, u.key_hint, u.created_at, u.last_seen_at, u.status,
  (select count(*) from public.sessions s where s.user_id = u.id)::int as session_count,
  (select coalesce(sum(s.unanswered_count), 0) from public.sessions s where s.user_id = u.id)::int
    as unanswered_count
from public.users u;

grant select on public.admin_session_list, public.admin_user_list to tp_app;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Normalizes and validates a private key; returns null when malformed.
create or replace function private.normalize_key(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_key, ''))) ~ '^[0-9a-f]{64}$' then lower(btrim(p_key))
    else null
  end;
$$;

-- -----------------------------------------------------------------------------
-- Visitor
-- -----------------------------------------------------------------------------

-- Signs in with a private key: links this browser's token to the key's user
-- (creating the access row on first use) and opens a new session.
create or replace function public.visitor_login(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := private.visitor_token_hash();
  v_key text := private.normalize_key(p_key);
  v_user public.users;
  v_access public.visitor_access;
  v_session public.sessions;
begin
  if v_hash is null then
    perform private.raise_error('not_authenticated');
  end if;
  if v_key is null then
    perform private.raise_error('invalid_key');
  end if;

  update public.users set last_seen_at = now()
  where access_key_hash = private.hash_token(v_key)
  returning * into v_user;
  if not found then
    perform private.raise_error('invalid_key');
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
      -- This browser token already belongs to another user. The API layer
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
    'user', jsonb_build_object('name', v_user.name),
    'session', private.session_json(v_session)
  );
end;
$$;

create or replace function public.visitor_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('name', u.name, 'status', u.status)
  from public.visitor_access va
  join public.users u on u.id = va.user_id
  where va.id = private.current_visitor_access_id();
$$;

-- -----------------------------------------------------------------------------
-- Admin
-- -----------------------------------------------------------------------------

-- Creates a user for a freshly generated key (generated by the API layer and
-- shown to the administrator once). Returns the new user's id.
create or replace function public.admin_create_user(p_name text, p_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_key text := private.normalize_key(p_key);
  v_id uuid;
begin
  if not private.is_admin() then
    perform private.raise_error('forbidden');
  end if;

  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  if char_length(v_name) = 0 or char_length(v_name) > 60 or v_name ~ '[[:cntrl:]]' then
    perform private.raise_error('invalid_name');
  end if;
  if v_key is null then
    perform private.raise_error('invalid_key');
  end if;

  insert into public.users (name, access_key_hash, key_hint)
  values (v_name, private.hash_token(v_key), right(v_key, 4))
  returning id into v_id;
  return v_id;
end;
$$;

-- Replaces a user's key and revokes every browser signed in with the old one.
create or replace function public.admin_regenerate_key(p_user_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := private.normalize_key(p_key);
begin
  if not private.is_admin() then
    perform private.raise_error('forbidden');
  end if;
  if v_key is null then
    perform private.raise_error('invalid_key');
  end if;

  update public.users
  set access_key_hash = private.hash_token(v_key), key_hint = right(v_key, 4)
  where id = p_user_id;
  if not found then
    perform private.raise_error('not_found');
  end if;

  update public.visitor_access set revoked_at = now()
  where user_id = p_user_id and revoked_at is null;
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
               s.id as session_id, s.session_code, u.name as user_name, u.key_hint as user_key_hint
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
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  private.normalize_key(text),
  public.visitor_login(text),
  public.admin_create_user(text, text),
  public.admin_regenerate_key(uuid, text)
from public;

grant execute on function
  public.visitor_login(text),
  public.admin_create_user(text, text),
  public.admin_regenerate_key(uuid, text)
to tp_app;
