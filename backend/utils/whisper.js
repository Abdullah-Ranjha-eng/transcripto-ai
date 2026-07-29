import fs from "fs";
import Groq from "groq-sdk";

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY });

// A little breathing room before the first word so the caption doesn't pop
// in at the exact frame speech starts — but never earlier than Whisper's
// own segment boundary. (Moved here from captionController so the
// audio-first flow in transcribeController gets identical timing behavior.)
const LEAD_IN_SECONDS = 0.12;

// Runs Groq Whisper on an audio file already sitting on disk and returns
// caption segments tightened to real word-start times.
export const transcribeAudioFile = async (audioPath) => {
  const transcription = await getGroq().audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-large-v3",
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
  });

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

  return { captions, language: transcription.language || "en" };
};
