create table public.seshat_hub_recipes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    recipe_type text not null check (recipe_type in ('household', 'food')),
    title text not null check (length(trim(title)) > 0),
    category text not null default '',
    ingredients text not null default '',
    instructions text not null default '',
    notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index seshat_hub_recipes_user_type_updated_idx
    on public.seshat_hub_recipes (user_id, recipe_type, updated_at desc);

alter table public.seshat_hub_recipes enable row level security;

create policy "Users manage their own recipes"
    on public.seshat_hub_recipes
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant select, insert, update, delete on public.seshat_hub_recipes to authenticated;
