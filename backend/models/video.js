import mongoose from "mongoose";

// cloudStatus tracks the async Cloudinary sync separately from the overall
// pipeline `status` below — the file is playable locally the moment it's
// "pending"/"uploading"; "done" just means Cloudinary now has its own copy.
const cloudAssetSchema = {
  public_id: String,
  url: String,              // local URL until Cloudinary upload finishes, then swapped
  localFilename: String,    // filename under backend/uploads/{videos,burned}
  cloudStatus: {
    type: String,
    enum: ["pending", "uploading", "done", "failed"],
    default: "pending",
  },
};

const videoSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title:      { type: String, required: true },
  originalVideo: cloudAssetSchema,
  burnedVideo:   cloudAssetSchema,
  detectedLanguage: { type: String, default: null },
  status: {
    type: String,
    // "uploading": record exists but the video file is still in flight to
    // Cloudinary from the browser — captions can already be "captioned"
    // even while status is technically still catching up here, since audio
    // transcription runs independently and often finishes first.
    enum: ["uploading", "uploaded", "processing", "captioned", "translated", "burned"],
    default: "uploading",
  },
}, { timestamps: true });

export default mongoose.model("Video", videoSchema);