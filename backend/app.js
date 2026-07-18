import dotenv from "dotenv";
dotenv.config({ path: "backend/config/config.env" });

import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { connectDatabase } from "./config/dbConnect.js";
import errorMiddleware from "./middlewares/errors.js";
import { ensureUploadDirs, UPLOADS_ROOT } from "./utils/localStorage.js";

ensureUploadDirs(); // no-op on Vercel — see utils/localStorage.js

// Routes
import authRoutes from "./routes/auth.js";
import videoRoutes from "./routes/video.js";
import captionRoutes from "./routes/caption.js";
import translateRoutes from "./routes/translate.js";

process.on("uncaughtException", (err) => {
  console.log(`Error: ${err.message}`);
  process.exit(1);
});

connectDatabase();

const app = express();

// Works locally (Vite dev server) and in production (deployed frontend).
// This must be the FRONTEND's origin — no trailing slash, since browsers
// never send one in the Origin header, so a mismatched slash silently
// breaks every CORS check.
const allowedOrigins = [
  "http://localhost:5173",
  "https://transcripto-ai-863i.vercel.app",
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));
app.use(cookieParser());

// Serves backend/uploads/videos and backend/uploads/burned so locally-saved
// files are watchable immediately, before/without waiting on Cloudinary.
app.use("/uploads", express.static(UPLOADS_ROOT));

app.use("/api/v1", authRoutes);
app.use("/api/v1", videoRoutes);
app.use("/api/v1", captionRoutes);
app.use("/api/v1", translateRoutes);

app.use(errorMiddleware);

// On Vercel, the platform invokes the exported app directly as a request
// handler — app.listen() is only for local/traditional server environments.
if (!process.env.VERCEL) {
  const server = app.listen(process.env.PORT, () => {
    console.log(`Server on PORT ${process.env.PORT} in ${process.env.NODE_ENV} mode.`);
  });

  process.on("unhandledRejection", (err) => {
    console.log(`Error: ${err.message}`);
    server.close(() => process.exit(1));
  });
}

export default app;