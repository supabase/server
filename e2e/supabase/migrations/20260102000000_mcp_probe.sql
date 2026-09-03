-- Probe schema for @supabase/server/mcp tool generation. Every object here
-- produces one case in src/mcp/__fixtures__/probe-spec.ts: the Swagger 2.0
-- document PostgREST serves for the `authenticated` role. See that file's
-- header for the capture command. The adapter scenarios do not touch these.

-- Identity primary key (required in the description, no default, so excluded
-- from create_), a NOT NULL column with `default auth.uid()`, a `default false`
-- boolean, a nullable column, and comments on the table and on one column.
create table public.tasks (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  notes text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.tasks is 'A user''s to-do items.';
comment on column public.tasks.title is 'Short label shown in the list.';

-- Composite primary key and no comments: fallback descriptions, and get_ /
-- delete_ require both key columns.
create table public.task_tags (
  task_id bigint not null references public.tasks (id) on delete cascade,
  tag text not null,
  primary key (task_id, tag)
);

-- View: PostgREST carries the base table's primary key over to the view's `id`
-- column, so the view gets the same five relation tools as a table.
create view public.open_tasks with (security_invoker = true) as
  select id, title, created_at from public.tasks where not done;

-- STABLE function with a comment: PostgREST exposes GET and POST, so the tool
-- is inferred read-only and the comment becomes its description.
create function public.task_summary(p_done boolean default false)
returns setof public.tasks
language sql stable security invoker
set search_path = ''
as $$ select * from public.tasks where done = p_done $$;
comment on function public.task_summary(boolean) is
  'Tasks filtered by completion state, scoped to the caller.';

-- VOLATILE function without a comment: POST only, fallback description, and
-- conservative annotations (openWorldHint: true).
create function public.complete_task(p_id bigint)
returns public.tasks
language sql volatile security invoker
set search_path = ''
as $$ update public.tasks set done = true where id = p_id returning * $$;

-- Deliberate collision: a function named exactly like the generated list tool
-- for `tasks`. Generation must fail with TOOL_NAME_COLLISION, never overwrite.
create function public.list_tasks()
returns setof public.tasks
language sql stable security invoker
set search_path = ''
as $$ select * from public.tasks $$;

alter table public.tasks enable row level security;
alter table public.task_tags enable row level security;

create policy "tasks: owner select" on public.tasks
  for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "tasks: owner insert" on public.tasks
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "tasks: owner update" on public.tasks
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "tasks: owner delete" on public.tasks
  for delete to authenticated
  using ((select auth.uid()) = owner_id);
create policy "task_tags: via task" on public.task_tags
  for all to authenticated
  using (exists (
    select 1 from public.tasks t
    where t.id = task_id and t.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.tasks t
    where t.id = task_id and t.owner_id = (select auth.uid())
  ));

-- PostgREST lists every verb a relation supports regardless of grants; grants
-- and RLS are enforced when a tool runs. task_tags has no UPDATE grant, so
-- update_task_tags is still generated and fails with `permission denied`.
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, delete on public.task_tags to authenticated;
grant select on public.open_tasks to authenticated;
grant execute on function
  public.task_summary(boolean),
  public.complete_task(bigint),
  public.list_tasks()
to authenticated;

-- No primary key: list_ and create_ are generated, get_ / update_ / delete_
-- are not.
create table public.audit_log (
  occurred_at timestamptz not null default now(),
  message text not null
);
alter table public.audit_log enable row level security;
create policy "audit_log: authenticated read" on public.audit_log
  for select to authenticated using (true);
create policy "audit_log: authenticated insert" on public.audit_log
  for insert to authenticated with check (true);
grant select, insert on public.audit_log to authenticated;
