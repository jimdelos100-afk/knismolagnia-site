-- V5.4 增量升级
-- 1) 实名认证第二字段由备注调整为身份证号
-- 2) 昵称注册后锁定；简介首次填写后锁定；头像首次上传后锁定
-- 3) 后续资料修改统一进入管理员审核，待审核期间不可重复提交
-- 4) 增加常用索引，减少成员/审核页面查询开销
-- 本迁移不会删除现有账号、等级、关注、投稿、留言或评论数据。

-- ---------- 实名认证：备注 -> 身份证号 ----------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='verification_applications' and column_name='note'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='verification_applications' and column_name='id_number'
  ) then
    alter table public.verification_applications rename column note to id_number;
  end if;
end $$;

alter table public.verification_applications
  alter column id_number drop default;

alter table public.verification_applications
  drop constraint if exists verification_applications_note_check;
alter table public.verification_applications
  drop constraint if exists verification_applications_id_number_check;

-- NOT VALID：不回溯破坏旧审核记录，但会约束此后新增/修改的数据。
alter table public.verification_applications
  add constraint verification_applications_id_number_check
  check (id_number ~ '^[0-9]{17}[0-9Xx]$') not valid;

-- ---------- 个人资料锁定状态 ----------
alter table public.profiles
  add column if not exists bio_locked boolean not null default false,
  add column if not exists avatar_locked boolean not null default false;

-- 已经填写/上传过的旧账号视为已经完成第一次设置。
update public.profiles
set bio_locked = true
where btrim(coalesce(bio,'')) <> '';

update public.profiles
set avatar_locked = true
where coalesce(avatar_url,'') <> '';

-- 禁止浏览器直接更新昵称/简介/头像，统一改走下方受控 RPC。
revoke update(display_name,bio,avatar_url) on public.profiles from authenticated;

-- ---------- 资料修改申请 ----------
create table if not exists public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_display_name text,
  requested_bio text,
  requested_avatar_url text,
  current_display_name text not null,
  current_bio text not null default '',
  current_avatar_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    requested_display_name is not null
    or requested_bio is not null
    or requested_avatar_url is not null
  )
);

alter table public.profile_change_requests enable row level security;

revoke all on public.profile_change_requests from anon, authenticated;
grant select on public.profile_change_requests to authenticated;

drop policy if exists "profile changes self or admin read" on public.profile_change_requests;
create policy "profile changes self or admin read"
on public.profile_change_requests for select
using (user_id=auth.uid() or public.is_admin());

create unique index if not exists profile_change_one_pending_per_user
on public.profile_change_requests(user_id)
where status='pending';

create index if not exists profile_change_user_created_idx
on public.profile_change_requests(user_id, created_at desc);

create index if not exists follows_followed_created_idx
on public.follows(followed_id, created_at desc);

create index if not exists verification_user_created_idx
on public.verification_applications(user_id, created_at desc);

-- 首次简介：仅允许从“未填写/未锁定”变为第一次正式内容。
create or replace function public.set_initial_profile_bio(new_bio text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  clean_bio text := btrim(coalesce(new_bio,''));
begin
  if me is null then raise exception '未登录'; end if;
  if char_length(clean_bio) < 1 or char_length(clean_bio) > 500 then
    raise exception '个人简介需要 1—500 个字符';
  end if;

  update public.profiles
  set bio=clean_bio, bio_locked=true
  where id=me
    and bio_locked=false
    and btrim(coalesce(bio,''))='';

  if not found then
    raise exception '个人简介已经完成首次设置，后续修改请提交管理员审核';
  end if;
end
$$;
revoke all on function public.set_initial_profile_bio(text) from public, anon, authenticated;
grant execute on function public.set_initial_profile_bio(text) to authenticated;

-- 首次头像：仅允许写入自己 avatars/<uid>/... 路径。
create or replace function public.set_initial_profile_avatar(new_avatar_url text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  clean_path text := btrim(coalesce(new_avatar_url,''));
begin
  if me is null then raise exception '未登录'; end if;
  if clean_path='' or clean_path not like (me::text || '/%') then
    raise exception '头像路径无效';
  end if;

  update public.profiles
  set avatar_url=clean_path, avatar_locked=true
  where id=me
    and avatar_locked=false
    and coalesce(avatar_url,'')='';

  if not found then
    raise exception '头像已经完成首次设置，后续修改请提交管理员审核';
  end if;
end
$$;
revoke all on function public.set_initial_profile_avatar(text) from public, anon, authenticated;
grant execute on function public.set_initial_profile_avatar(text) to authenticated;

-- 后续资料修改申请。昵称注册完成后也只能走此流程。
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
  request_id uuid;
begin
  if me is null then raise exception '未登录'; end if;

  if exists(select 1 from public.profile_change_requests where user_id=me and status='pending') then
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
      raise exception '个人简介尚未完成首次设置，请先在个人资料中填写并锁定';
    end if;
    if char_length(clean_bio) > 500 then raise exception '个人简介不能超过 500 个字符'; end if;
    if clean_bio = p.bio then clean_bio := null; end if;
  end if;

  if clean_avatar is not null then
    if p.avatar_locked=false then
      raise exception '头像尚未完成首次上传，请先在个人资料中上传并锁定';
    end if;
    if clean_avatar='' or clean_avatar not like (me::text || '/%') then
      raise exception '头像路径无效';
    end if;
    if clean_avatar = p.avatar_url then clean_avatar := null; end if;
  end if;

  if clean_name is null and clean_bio is null and clean_avatar is null then
    raise exception '没有检测到需要提交审核的资料变化';
  end if;

  insert into public.profile_change_requests(
    user_id,requested_display_name,requested_bio,requested_avatar_url,
    current_display_name,current_bio,current_avatar_url
  ) values (
    me,clean_name,clean_bio,clean_avatar,
    p.display_name,p.bio,p.avatar_url
  ) returning id into request_id;

  return request_id;
end
$$;
revoke all on function public.submit_profile_change_request(text,text,text) from public, anon, authenticated;
grant execute on function public.submit_profile_change_request(text,text,text) to authenticated;

-- 管理员审核。通过时才真正写入 profiles；驳回不改变现有资料。
-- 返回头像路径，供后台删除已经不用的旧文件/候选文件。
create or replace function public.review_profile_change_request(
  request_id uuid,
  decision text,
  review_note text default null
)
returns table (
  target_user_id uuid,
  old_avatar_url text,
  requested_avatar_url text,
  final_status text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid := auth.uid();
  r public.profile_change_requests%rowtype;
  before_avatar text;
begin
  if actor is null or not public.is_admin() then
    raise exception '仅管理员可以审核资料修改';
  end if;
  if decision not in ('approved','rejected') then
    raise exception '审核状态无效';
  end if;

  select * into r
  from public.profile_change_requests
  where id=request_id and status='pending'
  for update;

  if not found then raise exception '申请不存在或已处理'; end if;

  select avatar_url into before_avatar from public.profiles where id=r.user_id;

  if decision='approved' then
    update public.profiles
    set
      display_name = coalesce(r.requested_display_name, display_name),
      bio = case when r.requested_bio is not null then r.requested_bio else bio end,
      avatar_url = coalesce(r.requested_avatar_url, avatar_url),
      bio_locked = case when r.requested_bio is not null then true else bio_locked end,
      avatar_locked = case when r.requested_avatar_url is not null then true else avatar_locked end
    where id=r.user_id;
  end if;

  update public.profile_change_requests
  set status=decision,
      admin_note=nullif(btrim(coalesce(review_note,'')),''),
      reviewed_by=actor,
      reviewed_at=now(),
      updated_at=now()
  where id=request_id;

  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(
    actor,
    case when decision='approved' then '通过资料修改申请' else '驳回资料修改申请' end,
    'profile_change_request',
    request_id::text,
    jsonb_build_object('user_id',r.user_id,'requested_name',r.requested_display_name,'has_bio_change',r.requested_bio is not null,'has_avatar_change',r.requested_avatar_url is not null)
  );

  return query select r.user_id,before_avatar,r.requested_avatar_url,decision;
end
$$;
revoke all on function public.review_profile_change_request(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_profile_change_request(uuid,text,text) to authenticated;

-- 触摸更新时间。
drop trigger if exists profile_change_touch on public.profile_change_requests;
create trigger profile_change_touch
before update on public.profile_change_requests
for each row execute procedure public.touch_updated_at();
