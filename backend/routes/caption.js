import express from "express";
import multer from "multer";
import {
  generateCaptions,
  getVideoCaptions,
  updateCaptions,
  deleteCaptions,
  burnCaptions,
  downloadCaptions,        // ← ADD
} from "../controllers/captionController.js";
import { transcribeFromAudio } from "../controllers/transcribeController.js";
import { isAuthenticatedUser } from "../middlewares/auth.js";

// Audio only, in memory. These are extracted client-side (ffmpeg.wasm) from
// the video before/while the video itself uploads elsewhere, so they're
// small — nowhere near the size of the source video.
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB, generous for an mp3 of any reasonable video length
});

const router = express.Router();

router.route("/videos/:videoId/captions").post(isAuthenticatedUser, generateCaptions);
router.route("/videos/:videoId/captions").get(isAuthenticatedUser, getVideoCaptions);
router.route("/videos/:videoId/captions").put(isAuthenticatedUser, updateCaptions);
router.route("/videos/:videoId/captions").delete(isAuthenticatedUser, deleteCaptions);
router.route("/videos/:videoId/captions/burn").post(isAuthenticatedUser, burnCaptions);
router.route("/videos/:videoId/captions/download").get(isAuthenticatedUser, downloadCaptions); // ← ADD
router.route("/videos/:videoId/captions/from-audio").post(isAuthenticatedUser, uploadAudio.single("audio"), transcribeFromAudio);

export default router;