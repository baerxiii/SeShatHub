create table if not exists public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    endpoint text not null unique,
    subscription jsonb not null,
    user_agent text,
    created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "Users manage their own push subscriptions"
    on public.push_subscriptions
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create table if not exists public.push_reminders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    item_type text not null check (item_type in ('task', 'event')),
    item_id text not null,
    offset_minutes integer not null check (offset_minutes > 0),
    due_on date not null,
    due_time time not null,
    due_at timestamptz not null,
    remind_at timestamptz not null,
    url text not null check (url in ('tasks.html', 'calendar.html')),
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'sent', 'failed', 'expired')),
    attempts integer not null default 0,
    retry_at timestamptz,
    last_error text,
    sent_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, item_type, item_id, offset_minutes, due_at)
);

create index if not exists push_reminders_due_idx
    on public.push_reminders (remind_at)
    where status in ('pending', 'processing');

alter table public.push_reminders enable row level security;

create policy "Users view their own push reminders"
    on public.push_reminders
    for select
    to authenticated
    using (auth.uid() = user_id);

create policy "Users create their own push reminders"
    on public.push_reminders
    for insert
    to authenticated
    with check (auth.uid() = user_id);

create policy "Users delete their own push reminders"
    on public.push_reminders
    for delete
    to authenticated
    using (auth.uid() = user_id);

create or replace function public.claim_due_push_reminders(p_limit integer default 100)
returns setof public.push_reminders
language sql
security definer
set search_path = ''
as $$
    with expired as (
        update public.push_reminders
        set status = 'expired',
            updated_at = now()
        where status in ('pending', 'processing')
          and due_at <= now()
        returning id
    ),
    candidates as (
        select id
        from public.push_reminders
        where remind_at <= now()
          and coalesce(retry_at, remind_at) <= now()
          and due_at > now()
          and (
              status = 'pending'
              or (status = 'processing' and updated_at < now() - interval '5 minutes')
          )
        order by remind_at
        for update skip locked
        limit least(greatest(p_limit, 1), 500)
    )
    update public.push_reminders as reminders
    set status = 'processing',
        updated_at = now()
    from candidates
    where reminders.id = candidates.id
    returning reminders.*;
$$;

revoke all on function public.claim_due_push_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_push_reminders(integer) to service_role;

grant select, insert, delete on public.push_reminders to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_reminders, public.push_subscriptions to service_role;
