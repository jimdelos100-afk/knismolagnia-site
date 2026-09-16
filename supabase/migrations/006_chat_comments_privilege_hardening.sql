-- V5.3 权限加固：评论表仅允许已登录用户 INSERT，读取统一通过受控 RPC。
revoke all on public.thread_comments from anon, authenticated;
grant insert on public.thread_comments to authenticated;
