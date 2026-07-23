import express from "express";
import {
  uploadVideo,
  getUserVideos,
  getVideo,
  deleteVideo,
} from "../controllers/videoController.js";
import { isAuthenticatedUser } from "../middlewares/auth.js";
import multer from "multer";

// In-memory storage — the buffer goes straight to Cloudinary in the
// controller, never touching disk. This avoids writing to
// backend/uploads/videos, which doesn't exist / isn't writable on Vercel.
// (Vercel's own request-body size cap of ~4.5MB applies regardless of this
// fileSize limit — this just prevents oversized uploads locally too.)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});
const router = express.Router();

router.route("/videos").get(isAuthenticatedUser, getUserVideos);
router.route("/videos/upload").post(isAuthenticatedUser, upload.single("video"), uploadVideo);
router.route("/videos/:id").get(isAuthenticatedUser, getVideo);
router.route("/videos/:id").delete(isAuthenticatedUser, deleteVideo);

export default router;