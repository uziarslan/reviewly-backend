const mongoose = require("mongoose");
const logger = require("../utils/logger");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: parseInt(process.env.MONGODB_POOL_SIZE) || 10,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    logger.info({ host: conn.connection.host }, "MongoDB connected");
    return conn.connection.getClient().db(conn.connection.name);
  } catch (err) {
    logger.error({ err }, "MongoDB connection error");
    process.exit(1);
  }
};

module.exports = connectDB;
