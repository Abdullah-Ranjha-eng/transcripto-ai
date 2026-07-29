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
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import cloudinary from "cloudinary";
import { safeUnlink, localPathFor, VIDEOS_DIR } from "../utils/localStorage.js";
import { transcribeAudioFile } from "../utils/whisper.js";


ffmpeg.setFfmpegPath(ffmpegPath);

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
  // to when speech genuinely begins. (Shared with the audio-first flow in
  // (this file no longer has an audio-first counterpart, but keeping the helper shared is still good practice.)
  let captions, language;
  try {
    ({ captions, language } = await transcribeAudioFile(tmpAudio));
  } finally {
    // Only clean up the source video if it was a temp download — the local
    // upload copy is reused by later steps (translate/burn), so keep it.
    if (isTemp) fs.unlink(sourceVideo, () => {});
    fs.unlink(tmpAudio, () => {});
  }

  if (captions.length === 0)
    return next(new ErrorHandler("Could not generate captions. Try a clearer audio.", 400));

  let captionDoc = await Caption.findOne({ video: video._id, user: req.user._id });
  if (captionDoc) {
    captionDoc.captions = captions;
    captionDoc.language = language;
    await captionDoc.save();
  } else {
    captionDoc = await Caption.create({
      video: video._id,
      user: req.user._id,
      language,
      captions,
    });
  }

  video.status = "captioned";
  video.detectedLanguage = language;
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
  // /tmp is the ONLY writable location on Vercel — BURNED_DIR (under
  // backend/uploads) doesn't exist there and can't be created at runtime,
  // which is exactly what caused "Error opening output file ... No such
  // file or directory". Burn into /tmp and upload the result to Cloudinary
  // before responding, rather than the old local-folder + background-sync
  // pattern, which also isn't safe here: Vercel can freeze the function
  // right after the response is sent, killing an in-flight background
  // upload before it finishes.
  const outputPath = path.join(tmpDir, burnedFilename);

  fs.writeFileSync(srtPath, srtContent, "utf8");

  // 2. Get source video — reuses the local upload copy, no re-download
  const { filePath: inputPath, isTemp: inputIsTemp } = await getLocalOriginalPath(video);

  // 3. Burn subtitles with FFmpeg into /tmp
  //
  // IMPORTANT: the `subtitles` filter renders text via libass, which needs
  // fontconfig + installed font files to find *any* font by name. Vercel's
  // Node runtime has neither — so this filter used to run without error and
  // produce a "successful" burn with the video untouched (no visible text
  // at all), which is exactly what showed up in testing. Passing an
  // explicit `fontsdir` tells libass to scan that folder directly instead
  // of asking fontconfig, so it works with zero system font setup. The
  // font itself is bundled at backend/assets/fonts/DejaVuSans.ttf (DejaVu
  // fonts are released under the permissive Bitstream Vera license).
  const fontsDir = path.join(process.cwd(), "backend", "assets", "fonts");

  await new Promise((resolve, reject) => {
    const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const escapedFontsDir = fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");

    // NOTE: fluent-ffmpeg's outputOptions() splits each string on
    // whitespace to build the final argv list. Every value here used to
    // be space-free, so jamming "-vf <value>" into one string happened to
    // work. "FontName=DejaVu Sans" introduces a real space *inside* the
    // value, which that naive split then shredded mid-argument
    // ("Unrecognized option 'vf subtitles=...'"). Passing -vf and its
    // value as two separate array elements sidesteps the splitting
    // entirely — each element is already an atomic argv token.
    ffmpeg(inputPath)
      .outputOptions([
        "-vf",
        `subtitles='${escapedSrt}':fontsdir='${escapedFontsDir}':force_style='FontName=DejaVu Sans,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2'`,
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

  // 6. Upload the burned file to Cloudinary NOW, before responding — this
  //    is the part that used to be a "fire and forget" background job,
  //    which isn't reliable on Vercel (see note above). It's slower for
  //    the user, but it means the URL we return is always real and
  //    immediately playable, not a promise of one.
  const uploadResult = await cloudinary.v2.uploader.upload(outputPath, {
    resource_type: "video",
    folder: "transcripto-ai/burned",
    chunk_size: 6000000,
    timeout: 180000,
  });

  safeUnlink(outputPath);

  video.burnedVideo = {
    public_id: uploadResult.public_id,
    url: uploadResult.secure_url,
    cloudStatus: "done",
  };
  video.status = "burned";
  await video.save();

  res.status(200).json({
    success: true,
    message: "Captions burned into video successfully.",
    burnedVideo: video.burnedVideo,
  });

  // 7. Clean up the previous burned asset now that the new one is
  //    confirmed live in Cloudinary. This runs after the response but is
  //    just a delete — if the function gets frozen before it completes,
  //    worst case is a harmless orphaned asset in Cloudinary, not a
  //    broken video for the user.
  if (previousBurnedPublicId) {
    cloudinary.v2.uploader
      .destroy(previousBurnedPublicId, { resource_type: "video" })
      .catch(() => {});
  }
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