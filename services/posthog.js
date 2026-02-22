const { PostHog } = require("posthog-node");

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
const POSTHOG_PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

let client = null;

function getClient() {
  if (!client && POSTHOG_API_KEY) {
    client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
  }
  return client;
}

/**
 * Identify a user in PostHog (server-side).
 */
function identify(userId, properties = {}) {
  const ph = getClient();
  if (!ph) return;
  ph.identify({ distinctId: String(userId), properties });
}

/**
 * Capture a server-side event.
 */
function capture(userId, event, properties = {}) {
  const ph = getClient();
  if (!ph) return;
  ph.capture({ distinctId: String(userId), event, properties });
}

/**
 * Shutdown – flush pending events.
 */
async function shutdown() {
  if (client) await client.shutdown();
}

// ── PostHog Query API helpers (for admin analytics dashboard) ──

/**
 * Generic PostHog query via the HogQL API (POST /api/projects/:id/query).
 * Requires POSTHOG_PERSONAL_API_KEY.
 */
async function posthogQuery(query) {
  if (!POSTHOG_PERSONAL_API_KEY || !POSTHOG_PROJECT_ID) {
    throw new Error("PostHog personal API key or project ID not configured");
  }
  const res = await fetch(
    `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog API error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Run a HogQL query and return the results.
 */
async function hogqlQuery(hogqlString, limit = 1000) {
  return posthogQuery({
    kind: "HogQLQuery",
    query: hogqlString,
    limit,
  });
}

module.exports = {
  identify,
  capture,
  shutdown,
  posthogQuery,
  hogqlQuery,
};
