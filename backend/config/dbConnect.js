import mongoose from "mongoose";

export const connectDatabase = () => {
  const DB_URI = process.env.NODE_ENV === "DEVELOPMENT"
    ? process.env.DB_LOCAL_URI
    : process.env.DB_URI;

  mongoose.connect(DB_URI).then((con) => {
    console.log(`MongoDB connected: ${con.connection.host}`);
  });
};