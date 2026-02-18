const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const generateToken = require("../utils/generateToken");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

    // Verify the token with Google
    const ticket = await client.verifyIdToken({
      idToken: token,
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
    const jwtToken = generateToken(user._id);

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
