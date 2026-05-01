/**
 * Helpers for the manual GCash-paid premium tier.
 *
 * The legacy `subscription` shape is reused so analytics and the admin user
 * table keep working. A user is "premium active" when:
 *   - subscription.plan is one of the paid plans, AND
 *   - subscription.expiresAt is in the future (or unset → treated as active).
 *
 * Premium grants from the manual GCash flow set:
 *   subscription.plan = "premium"
 *   subscription.startDate = now
 *   subscription.expiresAt = 2026-08-09T23:59:59+08:00 (configurable)
 */

const PAID_PLANS = new Set(["weekly", "monthly", "quarterly", "premium"]);

// Default expiry for one-cycle Premium - Improvement Pack: end of CSE day.
const PREMIUM_PACK_EXPIRES_AT = new Date("2026-08-09T15:59:59.000Z"); // 2026-08-09 23:59:59 PHT (UTC+8)

function isPremiumActive(user) {
  if (!user) return false;
  const plan = user.subscription?.plan;
  if (!plan || !PAID_PLANS.has(plan)) return false;
  const expiresAt = user.subscription?.expiresAt;
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}

/**
 * Server-side feature access check. Mirrors the frontend helper from the
 * paywall spec so backend enforcement stays in sync.
 */
function canAccessFeature(user, feature) {
  if (isPremiumActive(user)) return true;

  switch (feature) {
    case "assessment":
    case "free_mock_form_a":
    case "readiness_checker":
    case "section_topic_breakdown":
    case "recommended_focus":
    case "answer_review":
    case "generate_initial_sprint_plan":
    case "view_sprint_preview":
      return true;

    case "start_sprint_task":
    case "additional_mock_form":
    case "fresh_mock_set":
    case "premium_practice_pack":
    case "regenerate_sprint_after_completion":
      return false;

    default:
      return false;
  }
}

/**
 * Public-safe shape returned to the client (auth/me, dashboard payloads).
 */
function publicPlanState(user) {
  const active = isPremiumActive(user);
  return {
    planType: active ? "premium" : "free",
    planStatus: active ? "active" : "expired",
    premiumStartedAt: active ? user.subscription?.startDate || null : null,
    premiumExpiresAt: active ? user.subscription?.expiresAt || null : null,
  };
}

module.exports = {
  isPremiumActive,
  canAccessFeature,
  publicPlanState,
  PREMIUM_PACK_EXPIRES_AT,
};
