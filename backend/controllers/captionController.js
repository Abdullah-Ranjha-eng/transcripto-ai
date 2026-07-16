import Caption from "../models/caption.js";
import Video from "../models/video.js";
import ErrorHandler from "../utils/errorHandler.js";
import catchAsyncErrors from "../middlewares/catchAsyncErrors.js";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import axios from "axios";
import Groq from "groq-sdk";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import cloudinary from "cloudinary";
import { toPublicUrl, safeUnlink, localPathFor, VIDEOS_DIR, BURNED_DIR } from "../utils/localStorage.js";
import { syncToCloudinaryInBackground } from "../utils/backgroundUpload.js";


ffmpeg.setFfmpegPath(ffmpegPath);

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY });

// Helper: download video to temp file
const downloadVideo = async (url, destPath) => {
  const response = await axios({ url, responseType: "stream" });
  await pipeline(response.data, createWriteStream(destPath));
};

// Helper: get a local, readable path to the video's original file for ffmpeg
// to work on. Reuses the file multer saved at upload time whenever it's
// still on disk — this skips an entire network download from Cloudinary,
// which is the main thing making caption generation / burning slow.
// Falls back to downloading from Cloudinary only if the local copy is gone.
const getLocalOriginalPath = async (video) => {
  const localFile = video.originalVideo?.localFilename
    ? localPathFor(VIDEOS_DIR, video.originalVideo.localFilename)
    : null;

  if (localFile && fs.existsSync(localFile)) {
    return { filePath: localFile, isTemp: false };
  }

  const tmpVideo = path.join(os.tmpdir(), `${video._id}_${Date.now()}.mp4`);
  await downloadVideo(video.originalVideo.url, tmpVideo);
  return { filePath: tmpVideo, isTemp: true };
};

// Helper: build .srt content from captions array
const toSRT = (captions) => {
  const pad = (n) => String(Math.floor(n)).padStart(2, "0");
  const toTimecode = (secs) => {
    const h = pad(secs / 3600);
    const m = pad((secs % 3600) / 60);
    const s = pad(secs % 60);
    const ms = String(Math.round((secs % 1) * 1000)).padStart(3, "0");
    return `${h}:${m}:${s},${ms}`;
  };
  return captions
    .map((c, i) => `${i + 1}\n${toTimecode(c.start)} --> ${toTimecode(c.end)}\n${c.text}`)
    .join("\n\n");
};

// ── Generate captions => POST /api/v1/videos/:videoId/captions ───────────
export const generateCaptions = catchAsyncErrors(async (req, res, next) => {
  const video = await Video.findById(req.params.videoId);
  if (!video) return next(new ErrorHandler("Video not found.", 404));
  if (video.user.toString() !== req.user._id.toString())
    return next(new ErrorHandler("Not authorized.", 403));

  // Get the source video — reuses the local file from upload when possible
  // (skips the Cloudinary download entirely, which is the slow part).
  const { filePath: sourceVideo, isTemp } = await getLocalOriginalPath(video);
  const tmpAudio = path.join(os.tmpdir(), `${video._id}_${Date.now()}.mp3`);

  // Extract audio using FFmpeg (much smaller than video)
  await new Promise((resolve, reject) => {
    ffmpeg(sourceVideo)
      .output(tmpAudio)
      .audioCodec("libmp3lame")
      .audioBitrate("64k")       // low bitrate = smaller file
      .noVideo()                 // strip video, audio only
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  // Check audio file size
  const audioStats = fs.statSync(tmpAudio);
  const audioSizeMB = audioStats.size / (1024 * 1024);
  console.log(`Audio extracted: ${audioSizeMB.toFixed(2)} MB`);

  // Transcribe with Groq Whisper. We ask for word-level timestamps too:
  // Whisper's segment.start often includes leading silence before the
  // speaker actually starts talking (especially after a pause), which makes
  // captions appear too early. Word timestamps let us tighten each caption
  // to when speech genuinely begins.
  let transcription;
  try {
    transcription = await getGroq().audio.transcriptions.create({
      file: fs.createReadStream(tmpAudio),
      model: "whisper-large-v3",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
    });
  } finally {
    // Only clean up the source video if it was a temp download — the local
    // upload copy is reused by later steps (translate/burn), so keep it.
    if (isTemp) fs.unlink(sourceVideo, () => {});
    fs.unlink(tmpAudio, () => {});
  }

  // A little breathing room before the first word so the caption doesn't
  // pop in at the exact frame speech starts — but never earlier than
  // Whisper's own segment boundary.
  const LEAD_IN_SECONDS = 0.12;
  const words = transcription.words || [];
  let wordIdx = 0;

  const captions = transcription.segments.map((seg, i) => {
    const nextSegStart = transcription.segments[i + 1]?.start ?? Infinity;
    const segWords = [];
    while (wordIdx < words.length && words[wordIdx].start < nextSegStart) {
      segWords.push(words[wordIdx]);
      wordIdx++;
    }

    const firstWordStart = segWords.length ? segWords[0].start : seg.start;
    const start = Math.max(seg.start, firstWordStart - LEAD_IN_SECONDS);

    return { start, end: seg.end, text: seg.text.trim() };
  });

  if (captions.length === 0)
    return next(new ErrorHandler("Could not generate captions. Try a clearer audio.", 400));

  let captionDoc = await Caption.findOne({ video: video._id, user: req.user._id });
  if (captionDoc) {
    captionDoc.captions = captions;
    captionDoc.language = transcription.language || "en";
    await captionDoc.save();
  } else {
    captionDoc = await Caption.create({
      video: video._id,
      user: req.user._id,
      language: transcription.language || "en",
      captions,
    });
  }

  video.status = "captioned";
  video.detectedLanguage = transcription.language || "en";
  await video.save();

  res.status(200).json({ success: true, captions: captionDoc });
});

// ── Get captions => GET /api/v1/videos/:videoId/captions ─────────────────
export const getVideoCaptions = catchAsyncErrors(async (req, res, next) => {
  const captionDoc = await Caption.findOne({
    video: req.params.videoId,
    user: req.user._id,
  });
  if (!captionDoc) return next(new ErrorHandler("Captions not found.", 404));
  res.status(200).json({ success: true, captions: captionDoc });
});

// ── Update captions => PUT /api/v1/videos/:videoId/captions ──────────────
export const updateCaptions = catchAsyncErrors(async (req, res, next) => {
  const { captions } = req.body;
  if (!captions || !Array.isArray(captions))
    return next(new ErrorHandler("Please provide captions array.", 400));

  const captionDoc = await Caption.findOne({
    video: req.params.videoId,
    user: req.user._id,
  });
  if (!captionDoc) return next(new ErrorHandler("Captions not found.", 404));

  captionDoc.captions = captions;
  await captionDoc.save();
  res.status(200).json({ success: true, captions: captionDoc });
});

// ── Delete captions => DELETE /api/v1/videos/:videoId/captions ───────────
export const deleteCaptions = catchAsyncErrors(async (req, res, next) => {
  const captionDoc = await Caption.findOneAndDelete({
    video: req.params.videoId,
    user: req.user._id,
  });
  if (!captionDoc) return next(new ErrorHandler("Captions not found.", 404));
  res.status(200).json({ success: true, message: "Captions deleted." });
});

// ── Burn captions => POST /api/v1/videos/:videoId/captions/burn ──────────
export const burnCaptions = catchAsyncErrors(async (req, res, next) => {
  const video = await Video.findById(req.params.videoId);
  if (!video) return next(new ErrorHandler("Video not found.", 404));
  if (video.user.toString() !== req.user._id.toString())
    return next(new ErrorHandler("Not authorized.", 403));

  const { language } = req.body;
  const query = { video: video._id, user: req.user._id };
  if (language) query.language = language;

  const captionDoc = await Caption.findOne(query);
  if (!captionDoc)
    return next(new ErrorHandler("No captions found. Generate or translate captions first.", 404));

  if (captionDoc.captions.length === 0)
    return next(new ErrorHandler("Captions are empty.", 400));

  // 1. Write SRT to temp file
  const srtContent = toSRT(captionDoc.captions);
  const tmpDir = os.tmpdir();
  const srtPath = path.join(tmpDir, `${video._id}_${Date.now()}.srt`);
  const burnedFilename = `${video._id}_${randomUUID()}.mp4`;
  const outputPath = localPathFor(BURNED_DIR, burnedFilename);

  fs.writeFileSync(srtPath, srtContent, "utf8");

  // 2. Get source video — reuses the local upload copy, no re-download
  const { filePath: inputPath, isTemp: inputIsTemp } = await getLocalOriginalPath(video);

  // 3. Burn subtitles with FFmpeg, writing straight into the persistent
  //    local "burned" folder so it's servable the instant this finishes.
  await new Promise((resolve, reject) => {
    const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");

    ffmpeg(inputPath)
      .outputOptions([
        `-vf subtitles='${escapedSrt}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2'`,
        "-c:v libx264",
        "-crf 23",
        "-preset fast",
        "-c:a copy",
      ])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  // 4. Cleanup the SRT (and the input, if it was a temp download fallback)
  safeUnlink(srtPath);
  if (inputIsTemp) safeUnlink(inputPath);

  // 5. Remember the previous burned Cloudinary asset so we can delete it
  //    once the new one finishes uploading (not before — avoids a gap
  //    where neither copy exists in Cloudinary).
  const previousBurnedPublicId = video.burnedVideo?.public_id || null;
  const previousBurnedLocalFilename = video.burnedVideo?.localFilename || null;

  // 6. Save the local, immediately-playable version and respond right away.
  video.burnedVideo = {
    localFilename: burnedFilename,
    url: toPublicUrl(outputPath),
    cloudStatus: "pending",
  };
  video.status = "burned";
  await video.save();

  res.status(200).json({
    success: true,
    message: "Captions burned into video successfully.",
    burnedVideo: video.burnedVideo,
  });

  // 7. Fire-and-forget: push the burned video to Cloudinary in the
  //    background, then clean up the previous burned asset.
  syncToCloudinaryInBackground(video._id, "burnedVideo", outputPath, "transcripto-ai/burned")
    .then(async () => {
      if (previousBurnedPublicId) {
        try {
          await cloudinary.v2.uploader.destroy(previousBurnedPublicId, { resource_type: "video" });
        } catch (_) {}
      }
      if (previousBurnedLocalFilename) {
        safeUnlink(localPathFor(BURNED_DIR, previousBurnedLocalFilename));
      }
    });
});

// ── Download captions => GET /api/v1/videos/:videoId/captions/download ────
// Query params: ?format=srt (default) or ?format=txt
//               ?language=Arabic (optional, defaults to original)
export const downloadCaptions = catchAsyncErrors(async (req, res, next) => {
  const { format = "srt", language } = req.query;

  if (!["srt", "txt"].includes(format))
    return next(new ErrorHandler("Invalid format. Use 'srt' or 'txt'.", 400));

  const video = await Video.findById(req.params.videoId);
  if (!video) return next(new ErrorHandler("Video not found.", 404));
  if (video.user.toString() !== req.user._id.toString())
    return next(new ErrorHandler("Not authorized.", 403));

  const query = { video: video._id, user: req.user._id };
  if (language) query.language = language;

  const captionDoc = await Caption.findOne(query);
  if (!captionDoc)
    return next(new ErrorHandler("Captions not found.", 404));

  if (captionDoc.captions.length === 0)
    return next(new ErrorHandler("Captions are empty.", 400));

  const safeTitle = video.title.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const langSuffix = language ? `_${language}` : "";

  if (format === "srt") {
    const content = toSRT(captionDoc.captions);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeTitle}${langSuffix}.srt"`
    );
    return res.send(content);
  }

  // format === "txt"
  const content = captionDoc.captions.map((c) => c.text).join("\n");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeTitle}${langSuffix}.txt"`
  );
  return res.send(content);
});