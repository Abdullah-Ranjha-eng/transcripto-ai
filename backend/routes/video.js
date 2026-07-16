import express from "express";
import path from "path";
import { randomUUID } from "crypto";
import {
  uploadVideo,
  getUserVideos,
  getVideo,
  deleteVideo,
} from "../controllers/videoController.js";
import { isAuthenticatedUser } from "../middlewares/auth.js";
import multer from "multer";
import { VIDEOS_DIR, ensureUploadDirs } from "../utils/localStorage.js";

ensureUploadDirs();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, VIDEOS_DIR),
    filename: (req, file, cb) => {
      cb(null, `${randomUUID()}${path.extname(file.originalname) || ".mp4"}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});
const router = express.Router();

router.route("/videos").get(isAuthenticatedUser, getUserVideos);
router.route("/videos/upload").post(isAuthenticatedUser, upload.single("video"), uploadVideo);
router.route("/videos/:id").get(isAuthenticatedUser, getVideo);
router.route("/videos/:id").delete(isAuthenticatedUser, deleteVideo);

export default router;
