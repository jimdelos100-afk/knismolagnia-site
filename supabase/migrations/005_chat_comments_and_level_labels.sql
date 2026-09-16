-- V5.3 增量升级：交流室留言评论。
-- 每个账号在每条留言下仅能评论一次；评论不可由普通用户重复编辑或删除。
-- 本迁移不会删除或重建现有账号、留言或内容数据。

create table if not exists public.thread_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  is_removed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(thread_id, user_id)
);

alter table public.thread_comments enable row level security;

-- 普通成员只能在自己有 Level 5 权限时，以自己的身份写入一次评论。
drop policy if exists "thread comments level5 insert" on public.thread_comments;
create policy "thread comments level5 insert" on public.thread_comments for insert
with check (
  user_id = auth.uid()
  and public.can_access_level(5)
  and exists(select 1 from public.threads t where t.id = thread_id)
);

-- 表本身不直接向普通成员开放读取，展示统一经安全函数处理，避免绕过成员资料遮罩规则。
revoke all on public.thread_comments from anon, authenticated;
grant insert on public.thread_comments to authenticated;

create index if not exists thread_comments_thread_created_idx
on public.thread_comments(thread_id, created_at);

-- 交流室评论列表：沿用成员 Level 隐私规则，高于当前用户 Level 的作者资料显示为星号。
create or replace function public.list_chat_comments_for_viewer()
returns table (
  id uuid,
  thread_id uuid,
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
    c.id,
    c.thread_id,
    c.user_id,
    c.body,
    c.created_at,
    m.access_level,
    case when v.role='admin' or m.access_level<=v.access_level then p.display_name else '******' end,
    case when v.role='admin' or m.access_level<=v.access_level then p.avatar_url else null end,
    (v.role='admin' or m.access_level<=v.access_level) as is_visible
  from public.thread_comments c
  join public.memberships m on m.user_id=c.user_id and m.status='active'
  join public.profiles p on p.id=c.user_id
  cross join viewer v
  where c.is_removed=false
    and (v.role='admin' or v.access_level>=5)
  order by c.created_at asc
  limit 1500;
$$;
revoke all on function public.list_chat_comments_for_viewer() from public, anon, authenticated;
grant execute on function public.list_chat_comments_for_viewer() to authenticated;

-- 仅返回当前账号已经评论过的留言 ID（即便评论后来被管理员隐藏，也仍算已评论一次）。
create or replace function public.my_chat_comment_threads()
returns table (thread_id uuid)
language sql stable security definer set search_path=public
as $$
  select c.thread_id
  from public.thread_comments c
  where c.user_id=auth.uid();
$$;
revoke all on function public.my_chat_comment_threads() from public, anon, authenticated;
grant execute on function public.my_chat_comment_threads() to authenticated;

-- 管理员隐藏违规评论而不物理删除，保留“每个账号每条留言只能评论一次”的唯一性记录。
create or replace function public.admin_remove_chat_comment(comment_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '仅管理员可以执行此操作';
  end if;
  update public.thread_comments set is_removed=true where id=comment_id;
  if not found then
    raise exception '评论不存在';
  end if;
end
$$;
revoke all on function public.admin_remove_chat_comment(uuid) from public, anon, authenticated;
grant execute on function public.admin_remove_chat_comment(uuid) to authenticated;
