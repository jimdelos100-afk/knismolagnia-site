create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '成员',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin')),
  access_level int not null default 2 check (access_level between 2 and 6),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.memberships where user_id=auth.uid() and role='admin' and status='active') $$;

create or replace function public.can_access_level(required_level int)
returns boolean language sql stable security definer set search_path=public
as $$
  select case
    when required_level <= 1 then true
    else exists(
      select 1 from public.memberships
      where user_id=auth.uid() and status='active' and access_level >= required_level
    )
  end
$$;

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  level int not null check (level between 1 and 6),
  kind text not null default 'page' check (kind in ('page','announcement','work')),
  title text not null,
  body text not null,
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_files (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  level int not null check (level between 1 and 6),
  bucket_id text not null,
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  bucket_id text not null default 'submissions',
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,new.email,coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'成员'));
  insert into public.memberships(user_id,role,access_level,status)
  values(new.id,'member',2,'active');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute procedure public.touch_updated_at();
create trigger memberships_touch before update on public.memberships for each row execute procedure public.touch_updated_at();
create trigger content_touch before update on public.content_items for each row execute procedure public.touch_updated_at();
create trigger submissions_touch before update on public.submissions for each row execute procedure public.touch_updated_at();
create trigger threads_touch before update on public.threads for each row execute procedure public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.content_items enable row level security;
alter table public.content_files enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.threads enable row level security;
alter table public.replies enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles self or admin read" on public.profiles for select using (id=auth.uid() or public.is_admin());
create policy "profiles self update" on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());
create policy "profiles admin read all" on public.profiles for select using (public.is_admin());

create policy "memberships self or admin read" on public.memberships for select using (user_id=auth.uid() or public.is_admin());
create policy "memberships admin update" on public.memberships for update using (public.is_admin()) with check (public.is_admin());

create policy "content readable by level" on public.content_items for select using (is_published and public.can_access_level(level) or public.is_admin());
create policy "content admin insert" on public.content_items for insert with check (public.is_admin());
create policy "content admin update" on public.content_items for update using (public.is_admin()) with check (public.is_admin());
create policy "content admin delete" on public.content_items for delete using (public.is_admin());

create policy "files readable by level" on public.content_files for select using (public.can_access_level(level) or public.is_admin());
create policy "files admin insert" on public.content_files for insert with check (public.is_admin());
create policy "files admin delete" on public.content_files for delete using (public.is_admin());

create policy "submission own or admin read" on public.submissions for select using (user_id=auth.uid() or public.is_admin());
create policy "submission level3 insert" on public.submissions for insert with check (user_id=auth.uid() and public.can_access_level(3));
create policy "submission admin update" on public.submissions for update using (public.is_admin()) with check (public.is_admin());

create policy "submission files own or admin read" on public.submission_files for select using (
  public.is_admin() or exists(select 1 from public.submissions s where s.id=submission_id and s.user_id=auth.uid())
);
create policy "submission files own insert" on public.submission_files for insert with check (
  exists(select 1 from public.submissions s where s.id=submission_id and s.user_id=auth.uid() and public.can_access_level(3))
);

create policy "threads level5 read" on public.threads for select using (public.can_access_level(5) or public.is_admin());
create policy "threads level5 insert" on public.threads for insert with check (user_id=auth.uid() and public.can_access_level(5));
create policy "threads own or admin delete" on public.threads for delete using (user_id=auth.uid() or public.is_admin());
create policy "replies level5 read" on public.replies for select using (public.can_access_level(5) or public.is_admin());
create policy "replies level5 insert" on public.replies for insert with check (user_id=auth.uid() and public.can_access_level(5));
create policy "replies own or admin delete" on public.replies for delete using (user_id=auth.uid() or public.is_admin());

create policy "audit admin read" on public.audit_logs for select using (public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit) values
('level-1','level-1',false,52428800),
('level-2','level-2',false,52428800),
('level-3','level-3',false,52428800),
('level-4','level-4',false,52428800),
('level-5','level-5',false,52428800),
('level-6','level-6',false,52428800),
('submissions','submissions',false,52428800)
on conflict (id) do nothing;

create policy "level1 files read" on storage.objects for select using (bucket_id='level-1');
create policy "level2 files read" on storage.objects for select using (bucket_id='level-2' and public.can_access_level(2));
create policy "level3 files read" on storage.objects for select using (bucket_id='level-3' and public.can_access_level(3));
create policy "level4 files read" on storage.objects for select using (bucket_id='level-4' and public.can_access_level(4));
create policy "level5 files read" on storage.objects for select using (bucket_id='level-5' and public.can_access_level(5));
create policy "level6 files read" on storage.objects for select using (bucket_id='level-6' and public.can_access_level(6));

create policy "admin uploads level files" on storage.objects for insert with check (
  bucket_id in ('level-1','level-2','level-3','level-4','level-5','level-6') and public.is_admin()
);
create policy "admin updates level files" on storage.objects for update using (
  bucket_id in ('level-1','level-2','level-3','level-4','level-5','level-6') and public.is_admin()
);
create policy "admin deletes level files" on storage.objects for delete using (
  bucket_id in ('level-1','level-2','level-3','level-4','level-5','level-6') and public.is_admin()
);

create policy "submission owner upload" on storage.objects for insert with check (
  bucket_id='submissions' and auth.uid()::text=(storage.foldername(name))[1] and public.can_access_level(3)
);
create policy "submission owner or admin read" on storage.objects for select using (
  bucket_id='submissions' and (auth.uid()::text=(storage.foldername(name))[1] or public.is_admin())
);
create policy "submission owner delete" on storage.objects for delete using (
  bucket_id='submissions' and auth.uid()::text=(storage.foldername(name))[1]
);

create or replace function public.audit_membership_change()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(auth.uid(),'更新成员权限','membership',new.user_id::text,
    jsonb_build_object('old_level',old.access_level,'new_level',new.access_level,'old_role',old.role,'new_role',new.role,'old_status',old.status,'new_status',new.status));
  return new;
end $$;
create trigger membership_audit after update on public.memberships for each row execute procedure public.audit_membership_change();