export function validPushSubscription(
  value: unknown,
  storedEndpoint: string,
): value is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (
    typeof value !== "object" || value === null || !("endpoint" in value) ||
    typeof value.endpoint !== "string" || value.endpoint !== storedEndpoint ||
    !("keys" in value) || typeof value.keys !== "object" ||
    value.keys === null ||
    !("p256dh" in value.keys) || typeof value.keys.p256dh !== "string" ||
    !("auth" in value.keys) || typeof value.keys.auth !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value.keys.p256dh) ||
    !/^[A-Za-z0-9_-]+$/.test(value.keys.auth)
  ) {
    return false;
  }
  try {
    const url = new URL(value.endpoint);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.port && !url.hash && (
        url.hostname === "fcm.googleapis.com" ||
        url.hostname === "updates.push.services.mozilla.com" ||
        url.hostname === "web.push.apple.com" ||
        url.hostname.endsWith(".push.apple.com")
      );
  } catch {
    return false;
  }
}
