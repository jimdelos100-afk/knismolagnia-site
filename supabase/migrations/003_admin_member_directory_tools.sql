-- V5.1 增量升级：管理员成员管理工具。
-- 不删除现有账号或数据；仅新增管理员删除账号 RPC 与必要的 Storage 删除权限。

create or replace function public.admin_delete_account(target_id uuid)
returns void
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  actor uuid := auth.uid();
  target_role text;
  target_status text;
  active_admins int;
begin
  if actor is null or not public.is_admin() then
    raise exception '仅管理员可以执行此操作';
  end if;

  if target_id is null then
    raise exception '缺少目标账号';
  end if;

  if target_id = actor then
    raise exception '不能在后台删除当前登录管理员账号';
  end if;

  select role, status into target_role, target_status
  from public.memberships
  where user_id = target_id;

  if target_role = 'admin' and target_status = 'active' then
    select count(*) into active_admins
    from public.memberships
    where role='admin' and status='active';

    if active_admins <= 1 then
      raise exception '不能删除最后一名可用管理员';
    end if;
  end if;

  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(actor,'管理员删除账号','user',target_id::text,
    jsonb_build_object('target_role',target_role,'target_status',target_status));

  delete from auth.users where id = target_id;

  if not found then
    raise exception '账号不存在或已被删除';
  end if;
end
$$;

revoke all on function public.admin_delete_account(uuid) from public;
grant execute on function public.admin_delete_account(uuid) to authenticated;

drop policy if exists "avatar admin delete" on storage.objects;
create policy "avatar admin delete" on storage.objects for delete
using (bucket_id='avatars' and public.is_admin());

drop policy if exists "submission admin delete" on storage.objects;
create policy "submission admin delete" on storage.objects for delete
using (bucket_id='submissions' and public.is_admin());
