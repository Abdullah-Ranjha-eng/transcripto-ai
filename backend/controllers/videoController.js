import Video from "../models/video.js";
import ErrorHandler from "../utils/errorHandler.js";
import catchAsyncErrors from "../middlewares/catchAsyncErrors.js";
import cloudinary from "cloudinary";
import { toPublicUrl, safeUnlink, localPathFor, VIDEOS_DIR, BURNED_DIR } from "../utils/localStorage.js";
import { syncToCloudinaryInBackground } from "../utils/backgroundUpload.js";


// Upload video => POST /api/v1/videos/upload
// multer (disk storage) has already saved the file to backend/uploads/videos
// by the time this runs. We respond immediately with a locally-playable URL
// and push the file to Cloudinary afterwards, in the background, so the
// user never waits on the Cloudinary round-trip.
export const uploadVideo = catchAsyncErrors(async (req, res, next) => {
  if (!req.file) return next(new ErrorHandler("Please upload a video file.", 400));

  const { title } = req.body;
  if (!title) {
    safeUnlink(req.file.path);
    return next(new ErrorHandler("Please provide a title.", 400));
  }

  const video = await Video.create({
    user: req.user._id,
    title,
    originalVideo: {
      localFilename: req.file.filename,
      url: toPublicUrl(req.file.path),
      cloudStatus: "pending",
    },
    status: "uploaded",
  });

  res.status(201).json({ success: true, video });

  // Fire-and-forget: not awaited on purpose, response has already gone out.
  syncToCloudinaryInBackground(video._id, "originalVideo", req.file.path, "transcripto-ai/videos");
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

  // Remove local copies, if any
  if (video.originalVideo?.localFilename)
    safeUnlink(localPathFor(VIDEOS_DIR, video.originalVideo.localFilename));
  if (video.burnedVideo?.localFilename)
    safeUnlink(localPathFor(BURNED_DIR, video.burnedVideo.localFilename));

  await video.deleteOne();
  res.status(200).json({ success: true, message: "Video deleted." });
});
