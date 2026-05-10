const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const SprintPlan = require("../models/SprintPlan");
const generateToken = require("../utils/generateToken");
const posthog = require("../services/posthog");

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const oauthClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  "postmessage"
);

const PREMIUM_WEEKLY_EMAILS = new Set([
  "rubielabajo093@gmail.com",
  "edwardcuyos8022@gmail.com",
  "estradasarahg4@gmail.com",
  "tanauanrose6@gmail.com",
  "marizabasillote@gmail.com",
  "kkstormrage11@gmail.com",
  "johnmichaelvigil0329@gmail.com",
  "nakiecyelko5@gmail.com",
  "jessicabmagbuhos@gmail.com",
  "monalindaalarba20@gmail.com",
  "janicepeninoy674@gmail.com",
  "pikachu4841097@gmail.com",
  "maorilanz18@gmail.com",
  "alamanvivian777@gmail.com",
  "ashleymariejacob14@gmail.com",
  "carmina.laurilla@gmail.com",
  "sahbuenaventura@gmail.com",
  "bornokpapaw@gmail.com",
  "abegailmarzan130@gmail.com",
  "danicakatedomanais@gmail.com",
  "hawkdo169@gmail.com",
  "evalyn.bautista05@gmail.com",
  "kristelann.mones@gmail.com",
  "garciajoycemae@gmail.com",
  "esperejanelle8@gmail.com",
  "santosjochelle619@gmail.com",
]);

async function loginFromIdToken({ idToken }) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  const { sub: googleId, email, given_name, family_name, picture } = payload;
  const normalizedEmail = (email || "").toLowerCase().trim();
  const shouldGrantWeekly = PREMIUM_WEEKLY_EMAILS.has(normalizedEmail);
  const now = new Date();
  const weeklyExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  let user = await User.findOne({ googleId });

  if (!user) {
    user = await User.create({
      googleId,
      firstName: given_name || "",
      lastName: family_name || "",
      email: normalizedEmail,
      profilePic: picture || "",
      isAdmin: false,
      subscription: shouldGrantWeekly
        ? { plan: "weekly", startDate: now, expiresAt: weeklyExpiry }
        : undefined,
    });
  } else {
    user.profilePic = picture || user.profilePic;
    await user.save();
  }

  const jwtToken = generateToken(user._id);

  // Server-side PostHog identification + login event
  posthog.identify(user._id, {
    email: user.email,
    first_name: user.firstName || given_name,
    last_name: user.lastName || family_name,
    plan_type: user.subscription?.plan || "free",
    signup_date: user.createdAt,
  });
  posthog.capture(user._id, "login_success", {
    email: user.email,
    plan_type: user.subscription?.plan || "free",
    login_method: "google",
  });

  return { user, jwtToken };
}

/**
 * POST /api/auth/google-login
 * Body: { token }   – the Google ID-token (credential) from the frontend
 *
 * Verifies the Google token, creates user if first login, returns JWT.
 */
exports.googleLogin = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res
        .status(400)
        .json({ success: false, message: "Google token is required" });
    }

    const { user, jwtToken } = await loginFromIdToken({ idToken: token });

    // Set cookie (httpOnly for security)
    res.cookie("token", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      token: jwtToken,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profilePic: user.profilePic,
        isAdmin: user.isAdmin,
        library: user.library,
        subscription: user.subscription,
        marketingEmails: user.marketingEmails,
        trialAssessment: user.trialAssessment,
        examType: user.examType,
        examDate: user.examDate,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/google-code-login
 * Body: { code } – OAuth authorization code from @react-oauth/google useGoogleLogin (auth-code flow)
 *
 * Exchanges code for tokens, verifies ID token, creates user if first login, returns JWT.
 */
exports.googleCodeLogin = async (req, res, next) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res
        .status(400)
        .json({ success: false, message: "Google code is required" });
    }

    if (!GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Server is missing GOOGLE_CLIENT_SECRET",
      });
    }

    const { tokens } = await oauthClient.getToken(code);
    const idToken = tokens.id_token;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "No id_token returned from Google token exchange",
      });
    }

    const { user, jwtToken } = await loginFromIdToken({ idToken });

    res.cookie("token", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token: jwtToken,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profilePic: user.profilePic,
        isAdmin: user.isAdmin,
        library: user.library,
        subscription: user.subscription,
        marketingEmails: user.marketingEmails,
        trialAssessment: user.trialAssessment,
        examType: user.examType,
        examDate: user.examDate,
      },
    });
  } catch (err) {
    next(err);
  }
};
/**
 * GET /api/auth/me
 * Returns the currently authenticated user.
 */
exports.getMe = async (req, res) => {
  res.json({ success: true, user: req.user });
};

/**
 * PUT /api/auth/me
 * Update editable profile fields (firstName, lastName, marketingEmails).
 */
exports.updateMe = async (req, res, next) => {
  try {
    const { firstName, lastName, marketingEmails, examDate, examType } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (marketingEmails !== undefined) user.marketingEmails = marketingEmails;

    // Track exam-type changes so we can clean up dependent state below.
    let examTypeChanged = false;
    if (examType !== undefined) {
      if (examType === null || examType === "professional" || examType === "subprofessional") {
        const next = examType || null;
        examTypeChanged = next !== user.examType;
        user.examType = next;
      } else {
        return res
          .status(400)
          .json({ success: false, message: "Invalid examType" });
      }
    }
    if (examDate !== undefined) {
      if (examDate === null || examDate === "") {
        user.examDate = null;
      } else {
        const parsed = new Date(examDate);
        if (!Number.isNaN(parsed.getTime())) user.examDate = parsed;
      }
    }

    await user.save();

    // Switching exam tracks invalidates the active sprint — it was planned
    // against the previous track's sections/topics. Mark it abandoned so the
    // dashboard restarts cleanly on the new track.
    if (examTypeChanged) {
      // Abandon both active and completed plans — switching tracks makes the
      // old plan irrelevant; the user must generate a fresh one for their new
      // track after taking an assessment or mock on that track.
      await SprintPlan.updateMany(
        { user: user._id, status: { $in: ["active", "completed"] } },
        { $set: { status: "abandoned" } }
      );
    }

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout
 */
exports.logout = (_req, res) => {
  res.cookie("token", "", { httpOnly: true, expires: new Date(0) });
  res.json({ success: true, message: "Logged out" });
};
