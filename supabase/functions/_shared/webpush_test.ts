import { validPushSubscription } from "./webpush.ts";
import webpush from "npm:web-push@3.6.7";

Deno.test("accepts supported browser push services only", () => {
  for (
    const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/Q/abc",
      "https://example.push.apple.com/Q/abc",
    ]
  ) {
    const subscription = {
      endpoint,
      keys: { p256dh: "key_123", auth: "auth-123" },
    };
    if (!validPushSubscription(subscription, endpoint)) {
      throw new Error(endpoint);
    }
  }
});

Deno.test("rejects malformed or attacker-controlled endpoints", () => {
  for (
    const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.attacker.test/abc",
      "https://127.0.0.1/abc",
      "https://fcm.googleapis.com:444/abc",
      "https://user@fcm.googleapis.com/abc",
    ]
  ) {
    const subscription = { endpoint, keys: { p256dh: "key", auth: "auth" } };
    if (validPushSubscription(subscription, endpoint)) {
      throw new Error(endpoint);
    }
  }
  const subscription = {
    endpoint: "https://fcm.googleapis.com/abc",
    keys: { p256dh: "key", auth: "auth" },
  };
  if (validPushSubscription(subscription, "https://fcm.googleapis.com/other")) {
    throw new Error("mismatched endpoint accepted");
  }
});

Deno.test("generates encrypted push requests with browser-compatible keys", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("Missing private key");
  const publicKey = btoa(String.fromCharCode(...new Uint8Array(raw)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const recipient = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const recipientKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", recipient.publicKey),
  );
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
      "/",
      "_",
    ).replaceAll("=", "");
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    keys: {
      p256dh: encode(recipientKey),
      auth: encode(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
  webpush.setVapidDetails("mailto:admin@example.com", publicKey, jwk.d);
  const request = webpush.generateRequestDetails(
    subscription,
    "Test reminder",
    {
      TTL: 60,
      topic: "12345678901234567890123456789012",
    },
  );
  if (
    request.headers["Content-Encoding"] !== "aes128gcm" ||
    request.headers.TTL !== 60 || !request.body ||
    request.body.toString().includes("Test reminder")
  ) {
    throw new Error("Invalid encrypted Web Push request");
  }
});
