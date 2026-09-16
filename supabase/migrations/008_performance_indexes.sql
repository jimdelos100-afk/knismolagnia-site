-- V5.4 性能补充：为高频关联查询补充索引。
-- 仅创建索引，不修改或删除业务数据。

create index if not exists submissions_user_created_idx
on public.submissions(user_id, created_at desc);

create index if not exists submission_files_submission_idx
on public.submission_files(submission_id);

create index if not exists threads_user_created_idx
on public.threads(user_id, created_at desc);

create index if not exists thread_comments_user_created_idx
on public.thread_comments(user_id, created_at desc);

create index if not exists replies_thread_created_idx
on public.replies(thread_id, created_at);

create index if not exists replies_user_created_idx
on public.replies(user_id, created_at desc);

create index if not exists content_files_content_idx
on public.content_files(content_id);

create index if not exists content_items_created_by_idx
on public.content_items(created_by);

create index if not exists content_files_created_by_idx
on public.content_files(created_by);

create index if not exists audit_logs_actor_created_idx
on public.audit_logs(actor_id, created_at desc);

create index if not exists verification_reviewed_by_idx
on public.verification_applications(reviewed_by);

create index if not exists profile_change_reviewed_by_idx
on public.profile_change_requests(reviewed_by);
