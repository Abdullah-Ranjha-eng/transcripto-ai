import express from "express";
import {
  initVideo,
  getUploadSignature,
  finalizeVideo,
  getUserVideos,
  getVideo,
  deleteVideo,
} from "../controllers/videoController.js";
import { isAuthenticatedUser } from "../middlewares/auth.js";

// The video file itself no longer passes through this server at all — the
// browser uploads it straight to Cloudinary using the signed params from
// /videos/sign-upload, then calls /videos/:id/finalize with the result.
// See utils/whisper.js + controllers/transcribeController.js for the
// parallel audio-transcription side of this.
const router = express.Router();

router.route("/videos").get(isAuthenticatedUser, getUserVideos);
router.route("/videos/init").post(isAuthenticatedUser, initVideo);
router.route("/videos/sign-upload").get(isAuthenticatedUser, getUploadSignature);
router.route("/videos/:id/finalize").put(isAuthenticatedUser, finalizeVideo);
router.route("/videos/:id").get(isAuthenticatedUser, getVideo);
router.route("/videos/:id").delete(isAuthenticatedUser, deleteVideo);

export default router;
