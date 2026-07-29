import express from "express";
import {
  generateCaptions,
  getVideoCaptions,
  updateCaptions,
  deleteCaptions,
  burnCaptions,
  downloadCaptions,        // ← ADD
} from "../controllers/captionController.js";
import { isAuthenticatedUser } from "../middlewares/auth.js";

const router = express.Router();

router.route("/videos/:videoId/captions").post(isAuthenticatedUser, generateCaptions);
router.route("/videos/:videoId/captions").get(isAuthenticatedUser, getVideoCaptions);
router.route("/videos/:videoId/captions").put(isAuthenticatedUser, updateCaptions);
router.route("/videos/:videoId/captions").delete(isAuthenticatedUser, deleteCaptions);
router.route("/videos/:videoId/captions/burn").post(isAuthenticatedUser, burnCaptions);
router.route("/videos/:videoId/captions/download").get(isAuthenticatedUser, downloadCaptions); // ← ADD

export default router;
