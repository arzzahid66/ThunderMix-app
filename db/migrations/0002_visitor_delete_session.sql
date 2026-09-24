-- =============================================================================
-- Visitors can delete sessions from their own history.
--
-- The session is hidden from the visitor (RLS) and closed, but kept for
-- operators, who can always see every session. A system message records it.
-- =============================================================================

alter table public.sessions add column visitor_hidden_at timestamptz;

-- Hidden sessions no longer belong to the visitor's view.
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
      and s.visitor_access_id = private.current_visitor_access_id()
  );
$$;

drop policy visitor_reads_own_sessions on public.sessions;
create policy visitor_reads_own_sessions on public.sessions
  for select to tp_app
  using (visitor_hidden_at is null and visitor_access_id = (select private.current_visitor_access_id()));

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
    and visitor_access_id = private.current_visitor_access_id()
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

revoke all on function public.visitor_delete_session(uuid) from public;
grant execute on function public.visitor_delete_session(uuid) to tp_app;

-- Expose the flag to the operator console (new column appended to the view).
create or replace view public.admin_session_list
with (security_invoker = true) as
select
  s.id, s.session_code, s.user_id, s.created_at, s.last_activity_at, s.updated_at, s.status,
  s.closed_at, s.message_count, s.unanswered_count,
  u.name as user_name, u.email as user_email, u.status as user_status,
  s.visitor_hidden_at
from public.sessions s
join public.users u on u.id = s.user_id;
