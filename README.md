# SeShatHub
The terminal hub for the SeShat Suite of apps

## Push reminders setup

The Hub is hosted as a static GitHub Pages site, so push delivery needs the
Supabase database migration, the `send-reminders` Edge Function, and a scheduled
invocation. Until these are configured, reminder selections can be saved only
after the migration is applied; push messages will not be sent. The selected
Deno-compatible [Web Push library](https://github.com/negrel/webpush) states
that its cryptography has not been reviewed by cryptography experts; this is
a tradeoff of the self-hosted approach.

1. Generate VAPID keys in a trusted local environment with
   `deno run https://raw.githubusercontent.com/negrel/webpush/v0.5.0/cmd/generate-vapid-keys.ts`.
   Save the JSON output's `publicKey` and `privateKey` JWK objects. The command
   also prints an application-server public key; keep that value for the next
   step. Set the two JWK objects as the Supabase Edge Function secrets
   `VAPID_PUBLIC_JWK` and `VAPID_PRIVATE_JWK`, plus `VAPID_SUBJECT` (a contact
   such as `mailto:you@example.com`). Supabase provides `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.
2. Replace `REPLACE_WITH_VAPID_PUBLIC_KEY` in `seshat-core.js` with the
   application-server public key. This public key is safe to include in the
   site; never commit the private JWK or service-role key.
3. Apply `supabase/migrations/20261107000000_push_reminders.sql` to the
   Supabase project, then deploy the function:
   `supabase functions deploy send-reminders`
4. In the Supabase SQL Editor, store the function URL and service-role key in
   Vault, replacing the placeholders:

   ```sql
   select vault.create_secret(
     'https://<project-ref>.supabase.co/functions/v1/send-reminders',
     'seshat_push_function_url'
   );
   select vault.create_secret(
     '<service-role-key>',
     'seshat_service_role_key'
   );
   ```

5. Schedule the sender to run every minute:

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
         'Authorization', 'Bearer ' || (
           select decrypted_secret from vault.decrypted_secrets
           where name = 'seshat_service_role_key'
         )
       ),
       body := '{}'::jsonb
     );
     $$
   );
   ```

   Supabase Cron and `pg_net` must be enabled for the project. Apply the
   migration before scheduling the function.
6. Deploy the site over HTTPS. Sign in, open **Settings**, and enable
   notifications on each device. On mobile, install SeShat Hub to the home
   screen if the browser requires it for push notifications.

Task reminders default to one day before, at 9:00 a.m. in the device's local
time zone. Calendar reminders default to one day before the event; events
without a start time use 9:00 a.m. Users can select additional one-hour,
15-minute, and custom-minute reminders. Notification titles contain the task
or event name.

## Projects
- Stern Archive: https://github.com/baerxiii/stern-archive
