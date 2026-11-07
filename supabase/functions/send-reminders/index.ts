import { createClient } from "@supabase/supabase-js";
import { sendOneSignalReminder } from "../_shared/onesignal.ts";

const oneSignalAppId = "b98b2b98-8510-49b3-b263-3bdc12dd7c3c";

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
const oneSignalApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");

if (!supabaseUrl || !serviceRoleKey || !oneSignalApiKey) {
  throw new Error(
    "Missing required Supabase or OneSignal environment variables.",
  );
}

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

      const notificationId = await sendOneSignalReminder({
        appId: oneSignalAppId,
        apiKey: oneSignalApiKey,
      }, {
        externalUserIds: [reminder.user_id],
        reminderId: reminder.id,
        title: title ||
          (reminder.item_type === "task" ? "Task due soon" : "Event coming up"),
        body: reminder.item_type === "task"
          ? "Your task is due soon."
          : "Your event is coming up.",
        url: reminder.url,
      });

      await updateReminder(reminder.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        retry_at: null,
        last_error: null,
      });
      console.info(
        `Delivered reminder ${reminder.id} via OneSignal ${notificationId}.`,
      );
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
