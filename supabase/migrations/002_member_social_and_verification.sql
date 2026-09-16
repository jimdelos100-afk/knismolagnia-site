-- V5 增量升级：不会删除现有账号、等级、投稿或内容数据。
-- 新增：简介、头像、同好列表、关注、实名认证申请、删除账户 RPC。

alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists verification_status text not null default 'unsubmitted'
    check (verification_status in ('unsubmitted','pending','approved','rejected'));

alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length check (char_length(bio) <= 500);

-- 普通成员只允许修改昵称、简介和头像路径，不能自行把实名认证状态改成“已通过”。
revoke update on public.profiles from authenticated;
grant update(display_name,bio,avatar_url) on public.profiles to authenticated;

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create table if not exists public.verification_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  real_name text not null check (char_length(real_name) between 1 and 80),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  provider text not null default 'manual',
  provider_reference text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.verification_applications
  add column if not exists provider text not null default 'manual',
  add column if not exists provider_reference text,
  add column if not exists verified_at timestamptz;

alter table public.follows enable row level security;
alter table public.verification_applications enable row level security;

-- 关注关系是私密数据：只有关注者本人、被关注者本人和管理员能看到对应记录。
drop policy if exists "follows private read" on public.follows;
create policy "follows private read" on public.follows for select
using (follower_id=auth.uid() or followed_id=auth.uid() or public.is_admin());

drop policy if exists "follows self insert" on public.follows;
create policy "follows self insert" on public.follows for insert
with check (follower_id=auth.uid() and follower_id<>followed_id and public.can_access_level(2));

drop policy if exists "follows self delete" on public.follows;
create policy "follows self delete" on public.follows for delete
using (follower_id=auth.uid() or public.is_admin());

-- 实名申请：用户只能看自己的；管理员可看全部并审核。
drop policy if exists "verification self or admin read" on public.verification_applications;
create policy "verification self or admin read" on public.verification_applications for select
using (user_id=auth.uid() or public.is_admin());

drop policy if exists "verification self insert" on public.verification_applications;
create policy "verification self insert" on public.verification_applications for insert
with check (
  user_id=auth.uid()
  and status='pending'
  and admin_note is null
  and reviewed_by is null
  and reviewed_at is null
  and not exists (
    select 1 from public.profiles p
    where p.id=auth.uid() and p.verification_status='approved'
  )
);

drop policy if exists "verification admin update" on public.verification_applications;
create policy "verification admin update" on public.verification_applications for update
using (public.is_admin()) with check (public.is_admin());

-- 一位用户同一时间只保留一条待审核实名申请。
create unique index if not exists verification_one_pending_per_user
on public.verification_applications(user_id)
where status='pending';

-- 同好列表：总是返回等级；只有目标成员等级 <= 当前用户等级时才返回真实资料。
create or replace function public.list_members_for_viewer()
returns table (
  user_id uuid,
  access_level int,
  display_name text,
  bio text,
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
    m.user_id,
    m.access_level,
    case when v.role='admin' or m.access_level<=v.access_level then p.display_name else '******' end,
    case when v.role='admin' or m.access_level<=v.access_level then p.bio else '******' end,
    case when v.role='admin' or m.access_level<=v.access_level then p.avatar_url else null end,
    (v.role='admin' or m.access_level<=v.access_level) as is_visible
  from public.memberships m
  join public.profiles p on p.id=m.user_id
  cross join viewer v
  where m.status='active'
  order by m.access_level desc, p.created_at asc;
$$;
revoke all on function public.list_members_for_viewer() from public;
grant execute on function public.list_members_for_viewer() to authenticated;

create or replace function public.can_view_member(target_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1
    from public.memberships viewer
    join public.memberships target on target.user_id=target_id
    where viewer.user_id=auth.uid()
      and viewer.status='active'
      and target.status='active'
      and (viewer.role='admin' or target.access_level<=viewer.access_level)
  )
$$;
revoke all on function public.can_view_member(uuid) from public;
grant execute on function public.can_view_member(uuid) to authenticated;

-- 私有头像 bucket；路径格式：<user_id>/<filename>
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "avatar owner upload" on storage.objects;
create policy "avatar owner upload" on storage.objects for insert with check (
  bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]
);

drop policy if exists "avatar owner update" on storage.objects;
create policy "avatar owner update" on storage.objects for update using (
  bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]
) with check (
  bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]
);

drop policy if exists "avatar owner delete" on storage.objects;
create policy "avatar owner delete" on storage.objects for delete using (
  bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]
);

drop policy if exists "avatar level read" on storage.objects;
create policy "avatar level read" on storage.objects for select using (
  bucket_id='avatars'
  and public.can_view_member(((storage.foldername(name))[1])::uuid)
);

-- 实名审核状态与 profile 同步。
create or replace function public.sync_verification_status()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if tg_op='INSERT' then
    update public.profiles set verification_status='pending' where id=new.user_id;
  elsif tg_op='UPDATE' and new.status is distinct from old.status then
    update public.profiles set verification_status=new.status where id=new.user_id;
    if new.status in ('approved','rejected') then
      new.reviewed_at=coalesce(new.reviewed_at,now());
      new.reviewed_by=coalesce(new.reviewed_by,auth.uid());
      if new.status='approved' then
        new.verified_at=coalesce(new.verified_at,now());
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists verification_status_sync on public.verification_applications;
create trigger verification_status_sync
before insert or update on public.verification_applications
for each row execute procedure public.sync_verification_status();

-- 更新时间
drop trigger if exists verification_touch on public.verification_applications;
create trigger verification_touch before update on public.verification_applications
for each row execute procedure public.touch_updated_at();

-- 用户自助删除账号。最后一名管理员不可自删，防止后台失去管理员。
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path=public,auth
as $$
declare
  me uuid := auth.uid();
  my_role text;
  active_admins int;
begin
  if me is null then
    raise exception '未登录';
  end if;

  select role into my_role from public.memberships where user_id=me;
  if my_role='admin' then
    select count(*) into active_admins
    from public.memberships
    where role='admin' and status='active';
    if active_admins<=1 then
      raise exception '最后一名管理员不能删除自己的账号';
    end if;
  end if;

  delete from auth.users where id=me;
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- 防止后台误操作导致系统失去最后一名可用管理员。
create or replace function public.protect_last_active_admin()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  active_admins int;
begin
  if old.role='admin' and old.status='active'
     and (new.role<>'admin' or new.status<>'active') then
    select count(*) into active_admins
    from public.memberships
    where role='admin' and status='active';
    if active_admins<=1 then
      raise exception '不能移除或停用最后一名管理员';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists protect_last_active_admin_trigger on public.memberships;
create trigger protect_last_active_admin_trigger
before update on public.memberships
for each row execute procedure public.protect_last_active_admin();
