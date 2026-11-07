import { createClient } from "@supabase/supabase-js";
import * as webpush from "@negrel/webpush";

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
const vapidPublicJwk = Deno.env.get("VAPID_PUBLIC_JWK");
const vapidPrivateJwk = Deno.env.get("VAPID_PRIVATE_JWK");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");

if (
  !supabaseUrl || !serviceRoleKey || !vapidPublicJwk || !vapidPrivateJwk ||
  !vapidSubject
) {
  throw new Error("Missing required Supabase or VAPID environment variables.");
}

const vapidKeys = await webpush.importVapidKeys({
  publicKey: JSON.parse(vapidPublicJwk),
  privateKey: JSON.parse(vapidPrivateJwk),
}, { extractable: false });
const applicationServer = await webpush.ApplicationServer.new({
  contactInformation: vapidSubject,
  vapidKeys,
});

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

  if (request.headers.get("authorization") !== `Bearer ${serviceRoleKey}`) {
    return new Response("Unauthorized", { status: 401 });
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
      const table = reminder.item_type === "task" ? "tasks" : "calendar_events";
      const { data: item, error: itemError } = await supabase
        .from(table)
        .select(
          reminder.item_type === "task"
            ? "title,completed,due_date"
            : "title,event_date,start_time",
        )
        .eq("id", reminder.item_id)
        .eq("user_id", reminder.user_id)
        .maybeSingle();

      if (itemError) {
        throw itemError;
      }

      const itemTime = reminder.item_type === "task"
        ? "09:00"
        : ((item?.start_time || "09:00").slice(0, 5));
      const itemDate = reminder.item_type === "task"
        ? item?.due_date
        : item?.event_date;

      if (
        !item || (reminder.item_type === "task" && item.completed) ||
        itemDate !== reminder.due_on ||
        itemTime !== reminder.due_time.slice(0, 5)
      ) {
        await updateReminder(reminder.id, { status: "expired" });
        continue;
      }

      const { data: subscriptions, error: subscriptionError } = await supabase
        .from("push_subscriptions")
        .select("id,endpoint,subscription")
        .eq("user_id", reminder.user_id);

      if (subscriptionError) {
        throw subscriptionError;
      }

      if (!subscriptions?.length) {
        await updateReminder(reminder.id, {
          status: "failed",
          last_error: "No registered push subscription.",
        });
        continue;
      }

      const payload = JSON.stringify({
        title: item.title ||
          (reminder.item_type === "task" ? "Task due soon" : "Event coming up"),
        body: reminder.item_type === "task"
          ? "Your task is due soon."
          : "Your event is coming up.",
        url: reminder.url,
        tag: `${reminder.item_type}-${reminder.item_id}-${reminder.due_at}`,
      });

      let failed = false;
      let delivered = false;
      for (const subscription of subscriptions) {
        try {
          await applicationServer
            .subscribe(subscription.subscription)
            .pushTextMessage(payload, {
              ttl: 86400,
              urgency: webpush.Urgency.High,
            });
          delivered = true;
        } catch (error) {
          const statusCode = error instanceof Error && "response" in error &&
              error.response instanceof Response
            ? error.response.status
            : 0;
          if (statusCode === 404 || statusCode === 410) {
            const { error: deleteError } = await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", subscription.id);
            if (deleteError) {
              throw deleteError;
            }
          } else {
            failed = true;
            console.error("Push delivery failed:", error);
          }
        }
      }

      if (!delivered && !failed) {
        await updateReminder(reminder.id, {
          status: "failed",
          last_error: "No active push subscriptions.",
        });
      } else if (failed && !delivered && reminder.attempts < 2) {
        await updateReminder(reminder.id, {
          status: "pending",
          attempts: reminder.attempts + 1,
          retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          last_error: "One or more push deliveries failed.",
        });
      } else {
        await updateReminder(reminder.id, {
          status: failed && !delivered ? "failed" : "sent",
          sent_at: failed && !delivered ? null : new Date().toISOString(),
          retry_at: null,
          last_error: failed && !delivered
            ? "Push delivery failed after retries."
            : null,
        });
        if (!failed || delivered) {
          sent++;
        }
      }
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
