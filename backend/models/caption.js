import mongoose from "mongoose";

const captionSchema = new mongoose.Schema({
  video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
  // Same owner pattern as models/video.js — see utils/ownership.js.
  user:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  guestId:  { type: String, default: null, index: true },
  language: { type: String, default: "en" },
  captions: [
    {
      start:   { type: Number, required: true },  // seconds.
      end:     { type: Number, required: true },
      text:    { type: String, required: true },
    }
  ],
}, { timestamps: true });

captionSchema.pre("validate", function () {
  if (!this.user && !this.guestId) {
    throw new Error("Caption must belong to either a user or a guestId.");
  }
});

export default mongoose.model("Caption", captionSchema);