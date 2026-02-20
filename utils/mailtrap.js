const { MailtrapClient } = require("mailtrap");

const TOKEN = process.env.MAILTRAP_TOKEN;
const client = TOKEN ? new MailtrapClient({ token: TOKEN }) : null;

const SUPPORT_TEMPLATE_UUID = process.env.MAILTRAP_SUPPORT_TEMPLATE_UUID;

const SUPPORT_SENDER = {
  email: "notifications@reviewly.ph",
  name: "Reviewly",
};

const SUPPORT_RECIPIENT = "support@reviewly.ph";

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

module.exports = { sendEmail, sendSupportNotification };
