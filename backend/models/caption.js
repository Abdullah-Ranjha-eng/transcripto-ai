import mongoose from "mongoose";

const captionSchema = new mongoose.Schema({
  video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
  user:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  language: { type: String, default: "en" },
  captions: [
    {
      start:   { type: Number, required: true },  // seconds
      end:     { type: Number, required: true },
      text:    { type: String, required: true },
    }
  ],
}, { timestamps: true });

export default mongoose.model("Caption", captionSchema);