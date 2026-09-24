import Caption from "../models/caption.js";
import Video from "../models/video.js";
import ErrorHandler from "../utils/errorHandler.js";
import catchAsyncErrors from "../middlewares/catchAsyncErrors.js";
import { ownerFields, isOwner } from "../utils/ownership.js";
import Groq from "groq-sdk";

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY });

const SUPPORTED_LANGUAGES = [
  "English", "Arabic", "French", "Spanish", "German", "Urdu", "Hindi",
  "Chinese", "Turkish", "Russian", "Italian", "Portuguese", "Japanese"
];

// How many captions are sent to the model per request. Long videos are
// translated in several small requests instead of one huge one.
const CHUNK_SIZE = 40;

// Translates one batch of strings. Retries once if the reply isn't a valid
// JSON array with exactly the same number of items.
const translateChunk = async (texts, targetLanguage, attempt = 1) => {
  try {
    const completion = await getGroq().chat.completions.create({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: `You are a professional subtitle translator.
Translate the following JSON array of strings to ${targetLanguage}.
Return ONLY a valid JSON array of translated strings, with exactly ${texts.length} items, in the same order.
Do not add any explanation, markdown, or extra text.`,
        },
        { role: "user", content: JSON.stringify(texts) },
      ],
      temperature: 0.3,
    });

    const raw = completion.choices[0].message.content.trim();
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    if (!Array.isArray(parsed) || parsed.length !== texts.length) {
      throw new Error("Unexpected translation shape");
    }
    return parsed;
  } catch (err) {
    if (attempt < 2) return translateChunk(texts, targetLanguage, attempt + 1);
    throw err;
  }
};

// Translate captions => POST /api/v1/videos/:videoId/translate
export const translateCaptions = catchAsyncErrors(async (req, res, next) => {
  const { targetLanguage } = req.body;
  if (!targetLanguage)
    return next(new ErrorHandler("Please provide a targetLanguage.", 400));

  if (!SUPPORTED_LANGUAGES.includes(targetLanguage))
    return next(new ErrorHandler(
      `Unsupported language. Supported: ${SUPPORTED_LANGUAGES.join(", ")}`, 400
    ));

  const video = await Video.findById(req.params.videoId);
  if (!video) return next(new ErrorHandler("Video not found.", 404));
  if (!isOwner(video, req))
    return next(new ErrorHandler("Not authorized.", 403));

  const captionDoc = await Caption.findOne({ video: video._id, ...ownerFields(req) });
  if (!captionDoc)
    return next(new ErrorHandler("No captions found. Generate captions first.", 404));

  // Translate in batches so long videos don't hit output-size or time limits
  const texts = captionDoc.captions.map((c) => c.text);
  const translatedTexts = [];

  try {
    for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
      const chunk = texts.slice(i, i + CHUNK_SIZE);
      translatedTexts.push(...(await translateChunk(chunk, targetLanguage)));
    }
  } catch (err) {
    console.error("Translation failed:", err.message);
    return next(new ErrorHandler("Translation failed. Please try again.", 500));
  }

  const translatedCaptions = captionDoc.captions.map((cap, i) => ({
    start: cap.start,
    end: cap.end,
    text: translatedTexts[i] || cap.text,
  }));

  // Upsert translated caption doc
  let translatedDoc = await Caption.findOne({
    video: video._id,
    ...ownerFields(req),
    language: targetLanguage,
  });

  if (translatedDoc) {
    translatedDoc.captions = translatedCaptions;
    await translatedDoc.save();
  } else {
    translatedDoc = await Caption.create({
      video: video._id,
      ...ownerFields(req),
      language: targetLanguage,
      captions: translatedCaptions,
    });
  }

  video.status = "translated";
  await video.save();

  res.status(200).json({ success: true, captions: translatedDoc });
});