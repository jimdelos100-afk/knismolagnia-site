-- 资料审核入口修复 + Level 3/4 作品目录字段
-- 本迁移不删除任何账号、资料、投稿或作品。

begin;

-- 昵称和头像（包括第一次上传）都进入同一条审核流程。
-- 数据库唯一索引 profile_change_one_pending_per_user 会保证审核前只能有一条申请。
create or replace function public.submit_profile_change_request(
  new_display_name text default null,
  new_bio text default null,
  new_avatar_url text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  p public.profiles%rowtype;
  clean_name text;
  clean_bio text;
  clean_avatar text;
  created_request_id uuid;
begin
  if me is null then raise exception '未登录'; end if;

  if exists (
    select 1 from public.profile_change_requests
    where user_id=me and status='pending'
  ) then
    raise exception '已有一条资料修改申请待审核，请等待管理员处理后再提交';
  end if;

  select * into p from public.profiles where id=me;
  if not found then raise exception '找不到个人资料'; end if;

  clean_name := case when new_display_name is null then null else btrim(new_display_name) end;
  clean_bio := case when new_bio is null then null else btrim(new_bio) end;
  clean_avatar := case when new_avatar_url is null then null else btrim(new_avatar_url) end;

  if clean_name is not null then
    if char_length(clean_name) < 1 or char_length(clean_name) > 40 then
      raise exception '昵称需要 1—40 个字符';
    end if;
    if clean_name = p.display_name then clean_name := null; end if;
  end if;

  if clean_bio is not null then
    if p.bio_locked=false then
      raise exception '个人简介尚未完成首次设置，请先填写首次简介';
    end if;
    if char_length(clean_bio) > 500 then
      raise exception '个人简介不能超过 500 个字符';
    end if;
    if clean_bio = p.bio then clean_bio := null; end if;
  end if;

  if clean_avatar is not null then
    if clean_avatar='' or clean_avatar not like (me::text || '/pending/%') then
      raise exception '候选头像路径无效';
    end if;
    if clean_avatar = p.avatar_url then clean_avatar := null; end if;
  end if;

  if clean_name is null and clean_bio is null and clean_avatar is null then
    raise exception '没有检测到需要提交审核的资料变化';
  end if;

  insert into public.profile_change_requests(
    user_id,
    requested_display_name,
    requested_bio,
    requested_avatar_url,
    current_display_name,
    current_bio,
    current_avatar_url
  ) values (
    me,
    clean_name,
    clean_bio,
    clean_avatar,
    p.display_name,
    p.bio,
    p.avatar_url
  )
  returning id into created_request_id;

  return created_request_id;
end;
$$;

revoke all on function public.submit_profile_change_request(text,text,text)
from public, anon, authenticated;
grant execute on function public.submit_profile_change_request(text,text,text)
to authenticated;

-- Level 3 / Level 4 作品字段。
alter table public.content_items
  add column if not exists cover_path text,
  add column if not exists author_name text,
  add column if not exists page_count integer,
  add column if not exists summary text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists sort_order integer not null default 0,
  add column if not exists search_text text not null default '';

alter table public.content_items
  drop constraint if exists content_items_page_count_check;
alter table public.content_items
  add constraint content_items_page_count_check
  check (page_count is null or page_count between 1 and 100000) not valid;

alter table public.content_items
  drop constraint if exists content_items_work_fields_check;
alter table public.content_items
  add constraint content_items_work_fields_check
  check (
    level not in (3,4)
    or kind <> 'work'
    or (
      btrim(coalesce(author_name,'')) <> ''
      and page_count is not null
      and btrim(coalesce(summary,'')) <> ''
    )
  ) not valid;

create or replace function public.refresh_content_search_text()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.search_text := lower(concat_ws(
    ' ',
    new.title,
    new.author_name,
    new.summary,
    array_to_string(new.tags, ' ')
  ));
  return new;
end;
$$;

drop trigger if exists content_search_text_refresh on public.content_items;
create trigger content_search_text_refresh
before insert or update of title, author_name, summary, tags
on public.content_items
for each row execute procedure public.refresh_content_search_text();

update public.content_items
set search_text = lower(concat_ws(
  ' ',
  title,
  author_name,
  summary,
  array_to_string(tags, ' ')
));

create index if not exists content_items_level_order_idx
on public.content_items(level, is_published, sort_order, created_at desc);

-- Level 3 / Level 4 成员投稿使用同一套作品模板。
alter table public.submissions
  add column if not exists target_level integer not null default 3,
  add column if not exists author_name text,
  add column if not exists page_count integer,
  add column if not exists summary text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists cover_path text,
  add column if not exists source_page text not null default 'Level 3 投稿箱',
  add column if not exists content_type text not null default '作品投稿';

alter table public.submissions
  drop constraint if exists submissions_target_level_check;
alter table public.submissions
  add constraint submissions_target_level_check
  check (target_level in (3,4)) not valid;

alter table public.submissions
  drop constraint if exists submissions_page_count_check;
alter table public.submissions
  add constraint submissions_page_count_check
  check (page_count is null or page_count between 1 and 100000) not valid;

drop policy if exists "submission level3 insert" on public.submissions;
drop policy if exists "submission work insert" on public.submissions;
create policy "submission work insert"
on public.submissions
for insert
to authenticated
with check (
  user_id=(select auth.uid())
  and target_level in (3,4)
  and public.can_access_level(target_level)
  and btrim(coalesce(author_name,'')) <> ''
  and page_count is not null
  and btrim(coalesce(summary,'')) <> ''
);

create index if not exists submissions_target_status_created_idx
on public.submissions(target_level, status, created_at desc);

-- 旧的首次头像直存入口停止对浏览器开放，头像统一走审核申请。
revoke all on function public.set_initial_profile_avatar(text)
from public, anon, authenticated;

-- 收紧不应由匿名访问者直接调用的 SECURITY DEFINER 函数。
revoke all on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;
revoke all on function public.can_view_member(uuid) from public, anon;
grant execute on function public.can_view_member(uuid) to authenticated;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
revoke all on function public.list_members_for_viewer() from public, anon;
grant execute on function public.list_members_for_viewer() to authenticated;
revoke all on function public.list_chat_messages_for_viewer() from public, anon;
grant execute on function public.list_chat_messages_for_viewer() to authenticated;
revoke all on function public.list_chat_comments_for_viewer() from public, anon;
grant execute on function public.list_chat_comments_for_viewer() to authenticated;
revoke all on function public.my_chat_comment_threads() from public, anon;
grant execute on function public.my_chat_comment_threads() to authenticated;
revoke all on function public.admin_remove_chat_comment(uuid) from public, anon;
grant execute on function public.admin_remove_chat_comment(uuid) to authenticated;
revoke all on function public.protect_last_active_admin() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.sync_verification_status() from public, anon, authenticated;

commit;
