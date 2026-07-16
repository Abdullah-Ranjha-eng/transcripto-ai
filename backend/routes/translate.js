import express from "express";
import { translateCaptions } from "../controllers/translateController.js";
import { isAuthenticatedUser } from "../middlewares/auth.js";

const router = express.Router();

router.route("/videos/:videoId/translate").post(isAuthenticatedUser, translateCaptions);

export default router;
