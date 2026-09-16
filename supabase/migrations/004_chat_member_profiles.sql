-- V5.2 增量升级：聊天式交流室安全查询函数。
-- 不删除、不重建现有账号或内容数据。

create or replace function public.list_chat_messages_for_viewer()
returns table (
  id uuid,
  user_id uuid,
  body text,
  created_at timestamptz,
  access_level int,
  display_name text,
  avatar_url text,
  is_visible boolean
)
language sql stable security definer set search_path=public
as $$
  with viewer as (
    select m.access_level, m.role
    from public.memberships m
    where m.user_id=auth.uid() and m.status='active'
  )
  select
    t.id,
    t.user_id,
    t.body,
    t.created_at,
    m.access_level,
    case when v.role='admin' or m.access_level<=v.access_level then p.display_name else '******' end,
    case when v.role='admin' or m.access_level<=v.access_level then p.avatar_url else null end,
    (v.role='admin' or m.access_level<=v.access_level) as is_visible
  from public.threads t
  join public.memberships m on m.user_id=t.user_id and m.status='active'
  join public.profiles p on p.id=t.user_id
  cross join viewer v
  where (v.role='admin' or v.access_level>=5)
  order by t.created_at asc
  limit 300;
$$;

revoke all on function public.list_chat_messages_for_viewer() from public;
grant execute on function public.list_chat_messages_for_viewer() to authenticated;

create index if not exists threads_created_at_idx on public.threads(created_at);
