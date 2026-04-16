const mongoose = require("mongoose");
const logger = require("../utils/logger");

let dbPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection.getClient().db(mongoose.connection.name);
  }

  if (!dbPromise) {
    dbPromise = mongoose
      .connect(process.env.MONGO_URI, {
        maxPoolSize: parseInt(process.env.MONGODB_POOL_SIZE, 10) || 10,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      })
      .then((conn) => {
        logger.info({ host: conn.connection.host }, "MongoDB connected");
        return conn.connection.getClient().db(conn.connection.name);
      })
      .catch((err) => {
        dbPromise = null;
        logger.error({ err }, "MongoDB connection error");
        throw err;
      });
  }

  return dbPromise;
};

module.exports = connectDB;
