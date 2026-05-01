const { MailtrapClient } = require("mailtrap");

const TOKEN = process.env.MAILTRAP_TOKEN;
const client = TOKEN ? new MailtrapClient({ token: TOKEN }) : null;

const SUPPORT_TEMPLATE_UUID = process.env.MAILTRAP_SUPPORT_TEMPLATE_UUID;

const SUPPORT_SENDER = {
  email: "notifications@reviewly.ph",
  name: "Reviewly",
};

const DEFAULT_SENDER = SUPPORT_SENDER;

const SUPPORT_RECIPIENT = "support@reviewly.ph";

// Where to route admin-facing payment notifications. Falls back to support.
const PAYMENTS_RECIPIENT =
  process.env.PAYMENTS_NOTIFY_EMAIL || SUPPORT_RECIPIENT;

/**
 * Send an email via Mailtrap.
 * @param {Object} options
 * @param {string|{email: string, name?: string}} [options.from] - Sender (default: hello@demomailtrap.co / Mailtrap Test)
 * @param {Array<{email: string, name?: string}>|string} options.to - Recipients (email string or array of {email, name?})
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {string} [options.category] - Optional category (e.g. "Integration Test")
 * @returns {Promise<Object>} Mailtrap API response
 */
async function sendEmail({ from = DEFAULT_SENDER, to, subject, text, html, category }) {
  if (!client) {
    throw new Error("Mailtrap is not configured: MAILTRAP_TOKEN is missing");
  }

  const fromObj = typeof from === "string"
    ? { email: from, name: from }
    : { ...DEFAULT_SENDER, ...from };

  const recipients = Array.isArray(to)
    ? to.map((r) => (typeof r === "string" ? { email: r } : r))
    : [{ email: to }];

  const payload = {
    from: fromObj,
    to: recipients,
    subject,
    ...(text && { text }),
    ...(html && { html }),
    ...(category && { category }),
  };

  return client.send(payload);
}

/**
 * Send a support/contact form notification email via Mailtrap template.
 * @param {Object} vars - Template variables: ticketId, createdAt, source, category, email, firstName?, lastName?, userId?, planType?, message
 * @returns {Promise<Object>} Mailtrap API response
 */
async function sendSupportNotification(vars) {
  if (!client) {
    throw new Error("Mailtrap is not configured: MAILTRAP_TOKEN is missing");
  }

  const template_variables = {
    ticketId: String(vars.ticketId || ""),
    createdAt: String(vars.createdAt || ""),
    source: String(vars.source || ""),
    category: String(vars.category || ""),
    email: String(vars.email || ""),
    firstName: String(vars.firstName || ""),
    lastName: String(vars.lastName || ""),
    userId: String(vars.userId || ""),
    planType: String(vars.planType || ""),
    message: String(vars.message || ""),
  };

  return client.send({
    from: SUPPORT_SENDER,
    to: [{ email: SUPPORT_RECIPIENT }],
    template_uuid: SUPPORT_TEMPLATE_UUID,
    template_variables,
  });
}

/* ──────────────────────────────────────────────
   Premium / GCash payment-flow emails
   ────────────────────────────────────────────── */

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html><body style="font-family:Inter,Arial,sans-serif;background:#F5F4FF;margin:0;padding:24px;color:#1A1A2E;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #EFF0F6;padding:32px;">
    <h1 style="font-size:18px;font-weight:600;margin:0 0 16px;color:#45464E;">${escapeHtml(title)}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #EFF0F6;margin:24px 0;" />
    <p style="font-size:12px;color:#9CA3AF;margin:0;">This is an automated message from Reviewly. If you didn't expect this email, please ignore it.</p>
  </div>
</body></html>`;
}

/**
 * Notify the admin team that a new GCash payment confirmation was submitted.
 * Mirrors the contact-form admin alert — we no longer track payments inside
 * the app, so this email + the Google Sheet row are the only handoff.
 */
async function sendPaymentRequestAdminAlert({
  paymentId,
  createdAt,
  email,
  gcashRef,
  gcashName,
  proofImageUrl,
}) {
  if (!client) return null;
  const body = `
    <p>A new GCash payment confirmation was submitted on the upgrade form.</p>
    ${paymentId ? `<p><strong>Payment ID:</strong> ${escapeHtml(paymentId)}</p>` : ""}
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>GCash account name:</strong> ${escapeHtml(gcashName)}</p>
    <p><strong>GCash reference:</strong> ${escapeHtml(gcashRef)}</p>
    ${proofImageUrl ? `<p><strong>Proof of payment:</strong><br/><a href="${escapeHtml(proofImageUrl)}">${escapeHtml(proofImageUrl)}</a></p>` : "<p><em>No proof image uploaded.</em></p>"}
    <p><strong>Submitted:</strong> ${escapeHtml(new Date(createdAt || Date.now()).toISOString())}</p>
    <p style="margin-top:16px;">The full submission is also recorded in the Reviewly Payments tab of the support spreadsheet.</p>
  `;
  return client.send({
    from: SUPPORT_SENDER,
    to: [{ email: PAYMENTS_RECIPIENT }],
    subject: "New Premium payment confirmation",
    html: emailShell("New Premium payment confirmation", body),
    category: "Payments",
  });
}

/**
 * Confirmation receipt to the user that we received their payment submission.
 */
async function sendPaymentReceivedEmail({ to, gcashRef }) {
  if (!client) return null;
  const body = `
    <p>Hi! Thanks for upgrading to Reviewly Premium.</p>
    <p>We received your payment confirmation${gcashRef ? ` (ref <strong>${escapeHtml(gcashRef)}</strong>)` : ""}. Verification usually takes <strong>1–6 hours</strong>.</p>
    <p>You'll get another email as soon as your Premium access is active. In the meantime you can keep using Reviewly with your free account.</p>
    <p style="margin-top:16px;">— The Reviewly team</p>
  `;
  return client.send({
    from: SUPPORT_SENDER,
    to: [{ email: to }],
    subject: "We received your Premium payment — verifying now",
    html: emailShell("Payment received", body),
    category: "Payments",
  });
}

module.exports = {
  sendEmail,
  sendSupportNotification,
  sendPaymentRequestAdminAlert,
  sendPaymentReceivedEmail,
};
