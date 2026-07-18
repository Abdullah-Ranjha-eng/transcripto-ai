import dns from "dns";
import mongoose from "mongoose";

// Fixes "querySrv ECONNREFUSED" on Windows when router/VPN DNS can't
// resolve mongodb+srv SRV records, even though the string itself is valid.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

export const connectDatabase = () => {
  const DB_URI = process.env.NODE_ENV === "DEVELOPMENT" ? process.env.DB_LOCAL_URI : process.env.DB_URI;

  mongoose.connect(DB_URI)
    .then((con) => {
      console.log(`MongoDB connected: ${con.connection.host}`);
    })
    .catch((err) => {
      console.error(`MongoDB connection FAILED: ${err.message}`);
      process.exit(1);
    });
};