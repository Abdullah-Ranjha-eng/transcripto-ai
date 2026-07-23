import Video from "../models/video.js";
import ErrorHandler from "../utils/errorHandler.js";
import catchAsyncErrors from "../middlewares/catchAsyncErrors.js";
import cloudinary from "cloudinary";
import { safeUnlink, localPathFor, VIDEOS_DIR, BURNED_DIR } from "../utils/localStorage.js";


// Upload video => POST /api/v1/videos/upload
// multer holds the file in memory (see routes/video.js) — we stream that
// buffer straight to Cloudinary and never touch disk at all. This used to
// write to backend/uploads/videos via multer's disk storage, which doesn't
// exist and isn't writable on Vercel (ENOENT). Since request bodies on
// Vercel are capped around ~4.5MB anyway, anything that gets this far is
// small enough that waiting on the Cloudinary upload directly is fine —
// no need for a background sync + polling for this step.
export const uploadVideo = catchAsyncErrors(async (req, res, next) => {
  if (!req.file) return next(new ErrorHandler("Please upload a video file.", 400));

  const { title } = req.body;
  if (!title) return next(new ErrorHandler("Please provide a title.", 400));

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.v2.uploader.upload_stream(
      {
        resource_type: "video",
        folder: "transcripto-ai/videos",
        chunk_size: 6000000,
        timeout: 180000,
      },
      (err, uploadResult) => (err ? reject(err) : resolve(uploadResult))
    );
    stream.end(req.file.buffer);
  });

  const video = await Video.create({
    user: req.user._id,
    title,
    duration: typeof result.duration === "number" ? result.duration : null,
    originalVideo: {
      public_id: result.public_id,
      url: result.secure_url,
      cloudStatus: "done",
    },
    status: "uploaded",
  });

  res.status(201).json({ success: true, video });
});

// Get all videos for current user => GET /api/v1/videos
export const getUserVideos = catchAsyncErrors(async (req, res) => {
  const videos = await Video.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: videos.length, videos });
});

// Get single video => GET /api/v1/videos/:id
export const getVideo = catchAsyncErrors(async (req, res, next) => {
  const video = await Video.findById(req.params.id);
  if (!video) return next(new ErrorHandler("Video not found.", 404));
  if (video.user.toString() !== req.user._id.toString())
    return next(new ErrorHandler("Not authorized to view this video.", 403));

  res.status(200).json({ success: true, video });
});

// Delete video => DELETE /api/v1/videos/:id
export const deleteVideo = catchAsyncErrors(async (req, res, next) => {
  const video = await Video.findById(req.params.id);
  if (!video) return next(new ErrorHandler("Video not found.", 404));
  if (video.user.toString() !== req.user._id.toString())
    return next(new ErrorHandler("Not authorized to delete this video.", 403));

  // Remove from Cloudinary
  if (video.originalVideo?.public_id)
    await cloudinary.v2.uploader.destroy(video.originalVideo.public_id, { resource_type: "video" });
  if (video.burnedVideo?.public_id)
    await cloudinary.v2.uploader.destroy(video.burnedVideo.public_id, { resource_type: "video" });

  // Remove local copies, if any (only relevant for records created before
  // this fix, or when running locally where disk storage is still fine)
  if (video.originalVideo?.localFilename)
    safeUnlink(localPathFor(VIDEOS_DIR, video.originalVideo.localFilename));
  if (video.burnedVideo?.localFilename)
    safeUnlink(localPathFor(BURNED_DIR, video.burnedVideo.localFilename));

  await video.deleteOne();
  res.status(200).json({ success: true, message: "Video deleted." });
});