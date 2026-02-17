const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const generateToken = require("../utils/generateToken");

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.CLIENT_URL}/auth/google/callback`
);

/**
 * POST /api/auth/google
 * Body: { credential }   – the Google ID-token from the frontend
 *
 * Verifies the Google token, creates user if first login, returns JWT.
 */
exports.googleLogin = async (req, res, next) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res
        .status(400)
        .json({ success: false, message: "Google credential is required" });
    }

    // Verify the token with Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, given_name, family_name, picture } = payload;

    // Find or create user
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
      // Update profile pic on every login (in case it changed)
      user.profilePic = picture || user.profilePic;
      await user.save();
    }

    // Generate JWT
    const token = generateToken(user._id);

    // Set cookie (httpOnly for security)
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      token,
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
 * POST /api/auth/google/code
 * Body: { code, redirect_uri? }   – code from Google; redirect_uri should match the one used in the auth request (send from frontend to avoid env mismatch in production).
 *
 * Exchanges the code for tokens, verifies the user, creates if first login, returns JWT.
 */
exports.googleCodeLogin = async (req, res, next) => {
  try {
    const { code, redirect_uri: clientRedirectUri } = req.body;

    if (!code) {
      return res
        .status(400)
        .json({ success: false, message: "Authorization code is required" });
    }

    let redirectUri;
    if (clientRedirectUri && typeof clientRedirectUri === "string") {
      try {
        const parsed = new URL(clientRedirectUri);
        if (parsed.pathname !== "/auth/google/callback" && !parsed.pathname.endsWith("/auth/google/callback")) {
          return res.status(400).json({ success: false, message: "Invalid redirect_uri path" });
        }
        redirectUri = clientRedirectUri;
      } catch (_) {
        return res.status(400).json({ success: false, message: "Invalid redirect_uri" });
      }
    } else {
      redirectUri =
        process.env.GOOGLE_REDIRECT_URI ||
        `${(process.env.DOMAIN_FRONTEND || process.env.CLIENT_URL || "").replace(/\/$/, "")}/auth/google/callback`;
      if (!redirectUri || redirectUri.includes("undefined")) {
        return res.status(500).json({
          success: false,
          message: "Server misconfiguration: set GOOGLE_REDIRECT_URI or DOMAIN_FRONTEND (or CLIENT_URL) to your frontend URL, e.g. https://your-app.vercel.app",
        });
      }
    }

    // Exchange the authorization code for tokens
    const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
    const idToken = tokens.id_token;

    // Verify the ID token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, given_name, family_name, picture } = payload;

    // Find or create user
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

    // Generate JWT
    const token = generateToken(user._id);

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
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
    if (err.message === "invalid_request") {
      return res.status(400).json({
        success: false,
        message: "Google sign-in failed: redirect_uri mismatch or code already used. Ensure your frontend sends redirect_uri and it matches the URL in Google Cloud Console.",
      });
    }
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
