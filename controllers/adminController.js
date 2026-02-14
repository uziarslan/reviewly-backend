const bcrypt = require("bcryptjs");
const User = require("../models/User");
const generateToken = require("../utils/generateToken");

/* ──────────────────────────────────────────────
   AUTH
   ────────────────────────────────────────────── */

/**
 * POST /api/admin/login
 * Body: { email, password }
 */
exports.adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !user.isAdmin || !user.passwordHash) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    if (user.blocked) {
      return res
        .status(403)
        .json({ success: false, message: "Account is blocked" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isAdmin: user.isAdmin,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/me   (protect + admin)
 */
exports.getAdminMe = async (req, res) => {
  const { _id, firstName, lastName, email, isAdmin } = req.user;
  res.json({ success: true, user: { _id, firstName, lastName, email, isAdmin } });
};

/* ──────────────────────────────────────────────
   USER MANAGEMENT
   ────────────────────────────────────────────── */

/**
 * GET /api/admin/users?page=1&limit=10&search=...
 * Returns paginated user list (non-admin users).
 */
exports.getUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const search = (req.query.search || "").trim();

    const filter = { isAdmin: { $ne: true } };

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("firstName lastName email subscription blocked createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/users/:id
 * Update user subscription, block status, etc.
 */
exports.updateUser = async (req, res, next) => {
  try {
    const { subscription, blocked } = req.body;

    const update = {};

    if (subscription) {
      if (subscription.plan) update["subscription.plan"] = subscription.plan;
      if (subscription.startDate !== undefined)
        update["subscription.startDate"] = subscription.startDate || null;
      if (subscription.expiresAt !== undefined)
        update["subscription.expiresAt"] = subscription.expiresAt || null;
    }

    if (typeof blocked === "boolean") {
      update.blocked = blocked;
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    ).select("firstName lastName email subscription blocked createdAt");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/users/:id
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    next(err);
  }
};
