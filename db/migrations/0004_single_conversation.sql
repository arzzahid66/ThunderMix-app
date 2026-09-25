-- =============================================================================
-- One continuous conversation per user.
--
-- The private key is now the identity, so a visitor's sessions belong to the
-- USER, not to one browser: signing in with the key on any device shows the
-- same conversation. visitor_login() reuses the user's latest open session and
-- only opens a new one when there is none (e.g. an operator closed it).
-- =============================================================================

-- The user behind this browser's (unrevoked) token.
create or replace function private.current_visitor_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select va.user_id from public.visitor_access va
  where va.token_hash = private.visitor_token_hash()
    and va.revoked_at is null;
$$;

revoke all on function private.current_visitor_user_id() from public;
grant execute on function private.current_visitor_user_id() to tp_app;

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
      and s.visitor_hidden_at is null
      and s.user_id = private.current_visitor_user_id()
  );
$$;

drop policy visitor_reads_own_sessions on public.sessions;
create policy visitor_reads_own_sessions on public.sessions
  for select to tp_app
  using (visitor_hidden_at is null and user_id = (select private.current_visitor_user_id()));

-- -----------------------------------------------------------------------------
-- Login: reuse the latest open conversation.
-- -----------------------------------------------------------------------------
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

  select * into v_session from public.sessions
  where user_id = v_user.id and status = 'active' and visitor_hidden_at is null
  order by last_activity_at desc
  limit 1;
  if not found then
    v_session := private.create_session(v_user.id, v_access.id);
  end if;

  return jsonb_build_object(
    'user', jsonb_build_object('name', v_user.name),
    'session', private.session_json(v_session)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Sending: any of the user's (visible) sessions, from any of their browsers.
-- -----------------------------------------------------------------------------
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
  where id = p_session_id and user_id = v_user.id and visitor_hidden_at is null;
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

create or replace function public.visitor_delete_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  select * into v_session from public.sessions
  where id = p_session_id
    and visitor_hidden_at is null
    and user_id = private.current_visitor_user_id()
  for update;
  if not found then
    perform private.raise_error('session_not_found');
  end if;

  update public.sessions
  set visitor_hidden_at = now(),
      status = 'closed',
      closed_at = coalesce(closed_at, now())
  where id = p_session_id;

  insert into public.messages (session_id, sender_type, content)
  values (p_session_id, 'system', 'Visitor deleted this session from their history. Session closed.');
end;
$$;
