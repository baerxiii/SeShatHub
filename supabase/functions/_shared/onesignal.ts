export interface OneSignalReminder {
  externalUserIds: string[];
  reminderId: string;
  title: string;
  body: string;
  url: string;
}

export interface OneSignalConfig {
  appId: string;
  apiKey: string;
}

export async function sendOneSignalReminder(
  config: OneSignalConfig,
  reminder: OneSignalReminder,
  send: typeof fetch = fetch,
): Promise<string> {
  if (!config.appId || !config.apiKey) {
    throw new Error("OneSignal app ID and API key must be configured.");
  }
  if (
    !reminder.reminderId || !reminder.externalUserIds.length ||
    reminder.externalUserIds.some((id) => !id)
  ) {
    throw new Error(
      "OneSignal reminder ID and external user IDs are required.",
    );
  }

  const url = new URL(reminder.url, "https://baerxiii.github.io/SeShatHub/");
  if (
    url.origin !== "https://baerxiii.github.io" ||
    !url.pathname.startsWith("/SeShatHub/")
  ) {
    throw new Error("OneSignal reminder URL must point to the Hub.");
  }

  const response = await send("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Authorization": `Key ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: config.appId,
      target_channel: "push",
      include_aliases: {
        external_id: [...new Set(reminder.externalUserIds)],
      },
      idempotency_key: reminder.reminderId,
      headings: { en: reminder.title },
      contents: { en: reminder.body },
      url: url.href,
    }),
  });

  if (!response.ok) {
    throw new Error(`OneSignal request failed with HTTP ${response.status}.`);
  }

  const result: unknown = await response.json();
  if (
    typeof result !== "object" || result === null ||
    !("id" in result) || typeof result.id !== "string" || !result.id
  ) {
    throw new Error("OneSignal did not accept the reminder.");
  }
  return result.id;
}
