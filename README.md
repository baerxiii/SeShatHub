# SeShatHub
The terminal hub for the SeShat Suite of apps.

## Browser push reminders

The Hub uses standard Web Push, not OneSignal. Each authenticated user can
manage only their own browser subscriptions through Supabase row-level
security. Notification titles contain the task or event name and may appear
on the device's lock screen.

**Reminders do not work until the steps below are completed and a real
end-to-end reminder is tested.** Supabase usage limits and pricing still apply.
The prior OneSignal `send-reminders` function must be replaced before scheduling
the new one. Do not schedule both senders.

1. Apply `supabase/migrations/20261107000000_push_reminders.sql` if it is not
   already applied. Apply `supabase/migrations/20261107010000_push_config.sql`
   as well. The first migration is not safe to run a second time.
2. Visit `/SeShatHub/push-key-setup.html` on the deployed site and generate
   keys once. Copy them directly from the page into Supabase; never put the
   private key in chat, SQL, a public file, or Git.
3. In Supabase Edge Function secrets, add `VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY` using their matching values. Set `VAPID_SUBJECT` to an
   administrator's contact URL or `mailto:` address. The sender uses
   Supabase's default secret key for service authentication and its
   administrator client.
4. In Supabase SQL Editor, replace `<public-key>` below with **only the public
   key** and run it:

   ```sql
   insert into public.push_config (id, vapid_public_key)
   values (true, '<public-key>')
   on conflict (id) do update set vapid_public_key = excluded.vapid_public_key;
   ```

   The public key in the table must match `VAPID_PUBLIC_KEY`. Keep the same
   key pair; rotating it requires existing devices to resubscribe.
5. Deploy the new `send-reminders` Edge Function:
   `supabase functions deploy send-reminders`. This replaces the earlier
   OneSignal function. The sender requires the default Supabase secret key in
   the `apikey` header and validates push service endpoints before making
   network requests.
6. In Supabase Vault, create secrets named `seshat_push_function_url` containing
   `https://<project-ref>.supabase.co/functions/v1/send-reminders`, and
   `seshat_secret_key` containing the project's default secret key. Do not put
   that key in chat or Git. Enable Supabase Cron and `pg_net`, then schedule the
   sender once:

   ```sql
   select cron.schedule(
     'send-seshat-push-reminders',
     '* * * * *',
     $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets
               where name = 'seshat_push_function_url'),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'apikey', (
           select decrypted_secret from vault.decrypted_secrets
           where name = 'seshat_secret_key'
         )
       ),
       body := '{}'::jsonb
     );
     $$
   );
   ```

7. Publish the site over HTTPS. Sign in, open **Settings**, and enable
   notifications on each device. On iOS, add the site to the Home Screen first.
   Create an upcoming task or event with a reminder and confirm it arrives.
   Browser push subscriptions are not transferable between accounts; turn off
   notifications before switching accounts on a shared browser.

Task reminders default to one day before, at 9:00 a.m. in the device's local
time zone. Calendar reminders default to one day before the event; events
without a start time use 9:00 a.m. Users can select additional one-hour,
15-minute, and custom-minute reminders. Select **Create Event** to open the
creation form, or select **Edit** on a calendar event
to change its details, times, or reminders. Existing custom reminders are shown
as comma-separated minutes; remove an entry to remove that reminder. Only
reminders whose scheduled time is still in the future are scheduled.
The sender marks a reminder sent when at least one push service accepts it; a
failure on another device is recorded in `last_error`. Acceptance does not
guarantee that a device displayed the notification.

## Recipes

The Home & Life section links to separate Household Recipes and Food Recipes
pages. Each page can add, edit, search, and delete recipes, including their
ingredients, instructions, and notes. Recipes belong to the signed-in user and
are stored in Supabase; they are not shared between accounts.
Select a recipe's name to expand or collapse its details and actions.

Before using these pages, apply
`supabase/migrations/20261108000000_recipes.sql` in the Supabase SQL Editor or
through the project's normal migration process. The migration creates the
`seshat_hub_recipes` table and its per-user row-level security policy without
changing any existing `recipes` table; it must only be applied once. Deploy the
site files after applying it.

To enable image and PDF attachments, also apply
`supabase/migrations/20261108010000_recipe_attachments.sql` once, after the
recipes migration. It creates a private Storage bucket and per-user access
policies; Supabase Storage usage limits and pricing apply. Save a recipe first,
then use its **Upload files** control to attach JPEG, PNG, GIF, WebP or PDF
files up to 10 MB each. Attachments can be opened or removed from the recipe.
Deleting a recipe through the page also deletes its attachments.

## Projects
- Stern Archive: https://github.com/baerxiii/stern-archive

## E-book reader

Open the browser-based reader at
https://baerxiii.github.io/SeShatHub/ebook-reader.html. It reads local EPUB and
PDF files without uploading them; PDF pages can be selected and zoomed, and
EPUB books support page navigation, a table of contents, and text sizing.
