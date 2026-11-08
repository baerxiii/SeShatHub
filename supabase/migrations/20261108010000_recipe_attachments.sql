insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'seshat-recipe-attachments',
    'seshat-recipe-attachments',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
);

create policy "Users upload their own recipe attachments"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'seshat-recipe-attachments'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Users read their own recipe attachments"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'seshat-recipe-attachments'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Users delete their own recipe attachments"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'seshat-recipe-attachments'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

alter table public.seshat_hub_recipes
    add constraint seshat_hub_recipes_id_user_unique unique (id, user_id);

create table public.seshat_hub_recipe_attachments (
    id uuid primary key default gen_random_uuid(),
    recipe_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    file_name text not null,
    storage_path text not null unique,
    created_at timestamptz not null default now(),
    constraint recipe_attachment_owner foreign key (recipe_id, user_id)
        references public.seshat_hub_recipes (id, user_id) on delete cascade,
    constraint recipe_attachment_path check (
        split_part(storage_path, '/', 1) = user_id::text
        and split_part(storage_path, '/', 2) = recipe_id::text
        and split_part(storage_path, '/', 3) <> ''
        and split_part(storage_path, '/', 4) = ''
    )
);

create index seshat_hub_recipe_attachments_recipe_idx
    on public.seshat_hub_recipe_attachments (recipe_id, user_id);

alter table public.seshat_hub_recipe_attachments enable row level security;

create policy "Users manage their own recipe attachments"
    on public.seshat_hub_recipe_attachments
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant select, insert, delete on public.seshat_hub_recipe_attachments to authenticated;
