import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { validPushSubscription } from "../_shared/webpush.ts";

type Reminder = {
  id: string;
  user_id: string;
  item_type: "task" | "event";
  item_id: string;
  due_on: string;
  due_time: string;
  due_at: string;
  url: string;
  attempts: number;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");

if (
  !supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey ||
  !vapidSubject
) {
  throw new Error("Missing required Supabase or VAPID environment variables.");
}

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function updateReminder(id: string, values: Record<string, unknown>) {
  const { error } = await supabase
    .from("push_reminders")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedAuthorization = "Bearer " + serviceRoleKey;
  if (request.headers.get("authorization") !== expectedAuthorization) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: config, error: configError } = await supabase
    .from("push_config").select("vapid_public_key").eq("id", true)
    .maybeSingle();
  if (configError || !config || config.vapid_public_key !== vapidPublicKey) {
    console.error(
      "Push public key is missing or does not match the function configuration.",
    );
    return Response.json({ error: "Push configuration is invalid." }, {
      status: 503,
    });
  }

  const { data: reminders, error: claimError } = await supabase
    .rpc("claim_due_push_reminders", { p_limit: 25 });

  if (claimError) {
    console.error("Unable to claim scheduled reminders:", claimError);
    return Response.json({ error: "Unable to claim reminders." }, {
      status: 500,
    });
  }

  let sent = 0;
  for (const reminder of (reminders || []) as Reminder[]) {
    try {
      let title: string | null = null;
      let itemIsCurrent = false;
      if (reminder.item_type === "task") {
        const { data: task, error } = await supabase
          .from("tasks")
          .select("title,completed,due_date")
          .eq("id", reminder.item_id)
          .eq("user_id", reminder.user_id)
          .maybeSingle();
        if (error) {
          throw error;
        }
        title = task?.title || null;
        itemIsCurrent = Boolean(
          task && !task.completed && task.due_date === reminder.due_on &&
            "09:00" === reminder.due_time.slice(0, 5),
        );
      } else {
        const { data: event, error } = await supabase
          .from("calendar_events")
          .select("title,event_date,start_time")
          .eq("id", reminder.item_id)
          .eq("user_id", reminder.user_id)
          .maybeSingle();
        if (error) {
          throw error;
        }
        title = event?.title || null;
        itemIsCurrent = Boolean(
          event && event.event_date === reminder.due_on &&
            (event.start_time || "09:00").slice(0, 5) ===
              reminder.due_time.slice(0, 5),
        );
      }

      if (!itemIsCurrent) {
        await updateReminder(reminder.id, { status: "expired" });
        continue;
      }

      const { data: subscriptions, error: subscriptionError } = await supabase
        .from("push_subscriptions")
        .select("id,endpoint,subscription")
        .eq("user_id", reminder.user_id);
      if (subscriptionError) throw subscriptionError;
      if (!subscriptions?.length) {
        await updateReminder(reminder.id, {
          status: "failed",
          last_error: "No registered push subscription.",
        });
        continue;
      }

      const payload = JSON.stringify({
        title: title ||
          (reminder.item_type === "task" ? "Task due soon" : "Event coming up"),
        body: reminder.item_type === "task"
          ? "Your task is due soon."
          : "Your event is coming up.",
        url: reminder.url,
        tag: `${reminder.item_type}-${reminder.item_id}-${reminder.due_at}`,
      });
      let accepted = 0;
      let failed = 0;
      for (const row of subscriptions) {
        if (!validPushSubscription(row.subscription, row.endpoint)) {
          console.error(`Invalid push subscription ${row.id}.`);
          failed++;
          continue;
        }
        try {
          await webpush.sendNotification(row.subscription, payload, {
            TTL: Math.max(
              0,
              Math.min(
                86400,
                Math.floor((Date.parse(reminder.due_at) - Date.now()) / 1000),
              ),
            ),
            urgency: "high",
            timeout: 10000,
            topic: reminder.id.replaceAll("-", ""),
          });
          accepted++;
        } catch (error) {
          const status = error instanceof Error && "statusCode" in error &&
              typeof error.statusCode === "number"
            ? error.statusCode
            : undefined;
          if (status === 404 || status === 410) {
            const { error: deleteError } = await supabase
              .from("push_subscriptions").delete().eq("id", row.id);
            if (deleteError) throw deleteError;
          } else {
            failed++;
            console.error(
              `Push delivery failed for subscription ${row.id}:`,
              status || "network error",
            );
          }
        }
      }
      if (!accepted) {
        if (failed) {
          throw new Error("Push delivery failed for all active devices.");
        }
        await updateReminder(reminder.id, {
          status: "failed",
          last_error: "No active push subscriptions.",
        });
        continue;
      }
      await updateReminder(reminder.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        retry_at: null,
        last_error: failed ? "Delivery failed for one or more devices." : null,
      });
      sent++;
    } catch (error) {
      console.error(`Unable to deliver reminder ${reminder.id}:`, error);
      try {
        await updateReminder(reminder.id, {
          status: reminder.attempts < 2 ? "pending" : "failed",
          attempts: reminder.attempts + 1,
          retry_at: reminder.attempts < 2
            ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
            : null,
          last_error: String(error).slice(0, 1000),
        });
      } catch (updateError) {
        console.error(
          `Unable to update failed reminder ${reminder.id}:`,
          updateError,
        );
      }
    }
  }

  return Response.json({ claimed: reminders?.length || 0, sent });
});
