// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7?target=deno";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const webhookSecret = Deno.env.get("WEBHOOK_SECRET") ?? "";
const vapidPublic = Deno.env.get("PUSH_VAPID_PUBLIC_KEY") ?? "";
const vapidPrivate = Deno.env.get("PUSH_VAPID_PRIVATE_KEY") ?? "";
const emailApiKey = Deno.env.get("EMAIL_PROVIDER_API_KEY") ?? "";
const emailFrom = Deno.env.get("EMAIL_FROM") ?? "";
const appUrl = Deno.env.get("APP_URL") ?? "";

const supabase = createClient(supabaseUrl, serviceKey);

if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails("mailto:notify@monochat", vapidPublic, vapidPrivate);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  if (webhookSecret) {
    const headerSecret = req.headers.get("x-webhook-secret");
    if (headerSecret !== webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const payload = await req.json();
  const record = payload.record ?? payload;
  if (!record?.chat_id || !record?.user_id) {
    return new Response("No record", { status: 200 });
  }

  const { data: members } = await supabase
    .from("chat_members")
    .select("user_id")
    .eq("chat_id", record.chat_id);

  const recipients = (members || [])
    .map((member) => member.user_id)
    .filter((id) => id !== record.user_id);

  if (recipients.length === 0) {
    return new Response("No recipients", { status: 200 });
  }

  const { data: settings } = await supabase
    .from("notification_settings")
    .select("user_id, push_enabled, email_enabled, quiet_hours_start, quiet_hours_end")
    .in("user_id", recipients);

  const { data: mutes } = await supabase
    .from("chat_mutes")
    .select("user_id, muted_until")
    .eq("chat_id", record.chat_id)
    .in("user_id", recipients);

  const settingsByUser = new Map();
  (settings || []).forEach((row) => settingsByUser.set(row.user_id, row));

  const mutedByUser = new Map();
  (mutes || []).forEach((row) => mutedByUser.set(row.user_id, row.muted_until));

  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", record.user_id)
    .maybeSingle();

  const { data: chat } = await supabase
    .from("chats")
    .select("title, type")
    .eq("id", record.chat_id)
    .maybeSingle();

  const senderName = senderProfile?.display_name || "Someone";
  const chatTitle = chat?.title || (chat?.type === "dm" ? senderName : "New message");
  const preview = record.deleted_at
    ? "Message deleted"
    : (record.body || (record.attachment_url ? "Sent an attachment" : "New message"));

  const now = new Date();

  const pushTargets = [] as string[];
  const emailTargets = [] as string[];

  for (const userId of recipients) {
    const prefs = settingsByUser.get(userId) || {};
    if (prefs.quiet_hours_start && prefs.quiet_hours_end) {
      if (isWithinQuietHours(now, prefs.quiet_hours_start, prefs.quiet_hours_end)) {
        continue;
      }
    }
    const mutedUntil = mutedByUser.get(userId);
    if (mutedUntil && new Date(mutedUntil) > now) {
      continue;
    }
    if (prefs.push_enabled) {
      pushTargets.push(userId);
    }
    if (prefs.email_enabled) {
      emailTargets.push(userId);
    }
  }

  if (pushTargets.length && vapidPublic && vapidPrivate) {
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("user_id, subscription")
      .in("user_id", pushTargets);

    await Promise.all(
      (subscriptions || []).map((row) =>
        webpush.sendNotification(
          row.subscription,
          JSON.stringify({
            title: chatTitle,
            body: `${senderName}: ${preview}`,
            url: appUrl ? `${appUrl}/?chat=${record.chat_id}` : "/"
          })
        ).catch(() => null)
      )
    );
  }

  if (emailTargets.length && emailApiKey && emailFrom) {
    for (const userId of emailTargets) {
      const { data: user } = await supabase.auth.admin.getUserById(userId);
      const email = user.user?.email;
      if (!email) {
        continue;
      }
      await sendEmail({
        to: email,
        subject: `New message from ${senderName}`,
        html: `<p><strong>${senderName}</strong> in <strong>${chatTitle}</strong></p><p>${escapeHtml(preview)}</p>`
      });
    }
  }

  return new Response("ok", { status: 200 });
});

function isWithinQuietHours(now, start, end) {
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
}

async function sendEmail({ to, subject, html }) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${emailApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: emailFrom,
      to,
      subject,
      html
    })
  });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
