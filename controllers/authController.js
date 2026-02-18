const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const generateToken = require("../utils/generateToken");

// TODO: remove hardcoded secret; use GOOGLE_CLIENT_SECRET in env only
const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || "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";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const oauthClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  "postmessage"
);

async function loginFromIdToken({ idToken }) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  const { sub: googleId, email, given_name, family_name, picture } = payload;

  let user = await User.findOne({ googleId });

  if (!user) {
    user = await User.create({
      googleId,
      firstName: given_name || "",
      lastName: family_name || "",
      email,
      profilePic: picture || "",
      isAdmin: false,
    });
  } else {
    user.profilePic = picture || user.profilePic;
    await user.save();
  }

  const jwtToken = generateToken(user._id);

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
    const { firstName, lastName, marketingEmails } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (marketingEmails !== undefined) user.marketingEmails = marketingEmails;

    await user.save();
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
