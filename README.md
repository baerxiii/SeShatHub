# SeShatHub
The terminal hub for the SeShat Suite of apps

## Push notifications

The site uses OneSignal Web Push with the public App ID
`b98b2b98-8510-49b3-b263-3bdc12dd7c3c`. The SDK links each opted-in browser to
the signed-in Supabase user ID; the server targets that external ID. The
OneSignal REST API key is server-only and must never be added to the website or
committed to Git.

To activate reminders:

1. In OneSignal, configure Web Push using **Custom Code** for the site origin
   `https://baerxiii.github.io` (GitHub Pages subfolder sites use the origin,
   not the repository path). The SDK initialization in `seshat-core.js`
   configures the worker path and scope. Ensure this is the same app as the App
   ID above, and copy its REST API key.
2. In the Supabase Dashboard, open **Edge Functions** secrets for the project
   and add `ONESIGNAL_REST_API_KEY` with the OneSignal REST API key as its
   value. Do not paste the key into chat, website code, or a GitHub file.

3. Apply `supabase/migrations/20261107000000_push_reminders.sql` to the
   Supabase project and deploy the Edge Function:
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
   migration and deploy the function before scheduling it.
6. Publish the site over HTTPS. Sign in, open **Settings**, and enable
   notifications on each device. On iOS, add the site to the Home Screen first.
   Send a test notification from OneSignal and confirm a scheduled reminder
   arrives before relying on it.

Task reminders default to one day before, at 9:00 a.m. in the device's local
time zone. Calendar reminders default to one day before the event; events
without a start time use 9:00 a.m. Users can select additional one-hour,
15-minute, and custom-minute reminders. Notification titles contain the task
or event name.

## Projects
- Stern Archive: https://github.com/baerxiii/stern-archive
