-- V5.5：后台安全、按用户开启实名认证、Level 2 私密留言、审核来源、邮箱验证后建站内账号

-- 1. 只有邮箱确认后才创建 profiles / memberships。
create or replace function public.provision_confirmed_user(target auth.users)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if target.email_confirmed_at is null then return; end if;
  insert into public.profiles(id,email,display_name)
  values(target.id,target.email,coalesce(nullif(target.raw_user_meta_data->>'display_name',''),'成员'))
  on conflict(id) do nothing;
  insert into public.memberships(user_id,role,access_level,status)
  values(target.id,'member',2,'active') on conflict(user_id) do nothing;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$ begin perform public.provision_confirmed_user(new); return new; end $$;

create or replace function public.handle_user_email_confirmed()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.provision_confirmed_user(new);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed after update of email_confirmed_at on auth.users
for each row execute procedure public.handle_user_email_confirmed();
revoke all on function public.provision_confirmed_user(auth.users) from public,anon,authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.handle_user_email_confirmed() from public,anon,authenticated;

-- 清除历史未验证用户错误生成的“站内账号”；Auth 待验证身份保留，日后验证会自动重建。
delete from public.memberships m using auth.users u
where m.user_id=u.id and u.email_confirmed_at is null;
delete from public.profiles p using auth.users u
where p.id=u.id and u.email_confirmed_at is null;

-- 补齐已经验证但历史上缺少站内资料的账号。
do $$ declare u auth.users%rowtype; begin
  for u in select * from auth.users where email_confirmed_at is not null loop
    perform public.provision_confirmed_user(u);
  end loop;
end $$;

-- 2. 管理员按用户开启实名认证，默认关闭。
alter table public.profiles
  add column if not exists verification_enabled boolean not null default false;
revoke update(verification_enabled,verification_status) on public.profiles from authenticated;

create or replace function public.admin_set_verification_enabled(target_user_id uuid, enabled boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception '仅管理员可以修改实名认证开关'; end if;
  update public.profiles set verification_enabled=enabled where id=target_user_id;
  if not found then raise exception '用户不存在'; end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(auth.uid(),case when enabled then '开启实名认证' else '关闭实名认证' end,'profile',target_user_id::text,jsonb_build_object('source_page','后台成员管理'));
end $$;
revoke all on function public.admin_set_verification_enabled(uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_set_verification_enabled(uuid,boolean) to authenticated;

-- 用户提交实名认证时必须已被管理员开启且邮箱已验证。
drop policy if exists "verification own insert" on public.verification_applications;
drop policy if exists "verification user insert" on public.verification_applications;
drop policy if exists "verification self insert" on public.verification_applications;
create policy "verification enabled user insert" on public.verification_applications for insert to authenticated
with check (
  user_id=(select auth.uid())
  and exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=(select auth.uid()) and p.verification_enabled and u.email_confirmed_at is not null)
);

-- 3. Level 2 私密留言：用户只能提交和查看自己的，管理员可查看全部；绝不公开。
create table if not exists public.level2_private_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  source_page text not null default 'Level 2',
  content_type text not null default '私密留言',
  status text not null default 'pending' check(status in ('pending','reviewed','archived')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.level2_private_messages enable row level security;
revoke all on public.level2_private_messages from anon,authenticated;
grant select,insert on public.level2_private_messages to authenticated;
create policy "private message own or admin read" on public.level2_private_messages for select to authenticated
using(user_id=(select auth.uid()) or public.is_admin());
create policy "private message level2 insert" on public.level2_private_messages for insert to authenticated
with check(user_id=(select auth.uid()) and public.can_access_level(2) and source_page='Level 2' and content_type='私密留言');
create index if not exists level2_private_messages_pending_idx on public.level2_private_messages(status,created_at desc);
drop trigger if exists level2_private_message_touch on public.level2_private_messages;
create trigger level2_private_message_touch before update on public.level2_private_messages
for each row execute procedure public.touch_updated_at();

create or replace function public.admin_review_level2_message(message_id uuid, new_status text, note text default null)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception '仅管理员可以处理留言'; end if;
  if new_status not in ('reviewed','archived') then raise exception '状态无效'; end if;
  update public.level2_private_messages set status=new_status,admin_note=nullif(btrim(coalesce(note,'')),''),reviewed_by=auth.uid(),reviewed_at=now()
  where id=message_id and status='pending';
  if not found then raise exception '留言不存在或已处理'; end if;
end $$;
revoke all on function public.admin_review_level2_message(uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_review_level2_message(uuid,text,text) to authenticated;

-- 4. 所有主要待审核内容统一带来源字段，后台可明确显示用户和提交界面。
alter table public.verification_applications add column if not exists source_page text not null default '个人资料';
alter table public.verification_applications add column if not exists content_type text not null default '实名认证';
alter table public.profile_change_requests add column if not exists source_page text not null default '个人资料';
alter table public.profile_change_requests add column if not exists content_type text not null default '资料修改';
alter table public.submissions add column if not exists source_page text not null default 'Level 3 投稿箱';
alter table public.submissions add column if not exists content_type text not null default '作品投稿';

-- 5. 收紧后台相关数据库能力。Level 与 admin 角色完全分离。
revoke execute on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to anon,authenticated;
revoke execute on function public.can_access_level(integer) from public,anon;
grant execute on function public.can_access_level(integer) to anon,authenticated;
revoke insert,update,delete on public.memberships from anon,authenticated;
grant select on public.memberships to authenticated;
grant update on public.memberships to authenticated;
revoke insert,update,delete on public.audit_logs from anon,authenticated;
grant select on public.audit_logs to authenticated;
