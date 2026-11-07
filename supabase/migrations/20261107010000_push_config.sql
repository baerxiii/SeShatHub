create table if not exists public.push_config (
    id boolean primary key default true check (id),
    vapid_public_key text not null
);

alter table public.push_config enable row level security;

create policy "Signed-in users can read push configuration"
    on public.push_config for select to authenticated using (true);

grant select on public.push_config to authenticated;
grant all on public.push_config to service_role;
