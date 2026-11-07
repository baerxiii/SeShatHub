import { sendOneSignalReminder } from "./onesignal.ts";

const config = { appId: "app-id", apiKey: "test-key" };
const reminder = {
  subscriptionIds: ["device-1", "device-1", "device-2"],
  reminderId: "00000000-0000-4000-8000-000000000001",
  title: "Doctor appointment",
  body: "Your event is coming up.",
  url: "https://baerxiii.github.io/SeShatHub/calendar.html",
};

Deno.test("sends a targeted idempotent reminder", async () => {
  const send: typeof fetch = async (input, init) => {
    if (input !== "https://api.onesignal.com/notifications") {
      throw new Error("Wrong endpoint");
    }
    const body = JSON.parse(String(init?.body));
    if (
      body.idempotency_key !== reminder.reminderId ||
      JSON.stringify(body.include_subscription_ids) !==
        JSON.stringify(["device-1", "device-2"]) ||
      body.url !== reminder.url ||
      (init?.headers as Record<string, string>).Authorization !== "Key test-key"
    ) {
      throw new Error("Wrong notification request");
    }
    return new Response(JSON.stringify({ id: "notification-id" }));
  };
  const id = await sendOneSignalReminder(config, reminder, send);
  if (id !== "notification-id") throw new Error("Wrong response");
});

Deno.test("rejects unsafe URLs before contacting OneSignal", async () => {
  let called = false;
  const send: typeof fetch = async () => {
    called = true;
    return new Response();
  };
  try {
    await sendOneSignalReminder(config, {
      ...reminder,
      url: "https://example.com/",
    }, send);
    throw new Error("Expected an error");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("URL")) {
      throw error;
    }
  }
  if (called) throw new Error("Unexpected request");
});

Deno.test("reports API errors without including the API key", async () => {
  const send: typeof fetch = async () =>
    new Response("secret", { status: 401 });
  try {
    await sendOneSignalReminder(config, reminder, send);
    throw new Error("Expected an error");
  } catch (error) {
    if (
      !(error instanceof Error) || !error.message.includes("401") ||
      error.message.includes(config.apiKey)
    ) throw error;
  }
});

Deno.test("rejects a response without a notification ID", async () => {
  const send: typeof fetch = async () =>
    new Response(JSON.stringify({ errors: ["no recipients"] }));
  try {
    await sendOneSignalReminder(config, reminder, send);
    throw new Error("Expected an error");
  } catch (error) {
    if (
      !(error instanceof Error) || !error.message.includes("did not accept")
    ) throw error;
  }
});
