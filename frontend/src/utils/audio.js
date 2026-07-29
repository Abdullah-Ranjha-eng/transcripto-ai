import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

// The ffmpeg.wasm core (~25-30MB) is loaded once per tab and cached here —
// not once per upload. First upload in a session pays this download; later
// ones in the same tab reuse the already-loaded instance.
let ffmpegPromise = null;

const getFfmpeg = () => {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load();
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
};

// Extracts a small, low-bitrate mp3 track from a video File, entirely in
// the browser. This is what lets caption generation start immediately
// instead of waiting for the (much larger) video to finish uploading —
// the audio is typically 10-20x smaller and transcribes fast.
export const extractAudioInBrowser = async (file) => {
  const ffmpeg = await getFfmpeg();
  const ext = file.name.match(/\.\w+$/)?.[0] || ".mp4";
  const inputName = "input" + ext;

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec([
    "-i", inputName,
    "-vn",
    "-acodec", "libmp3lame",
    "-b:a", "64k",
    "audio.mp3",
  ]);
  const data = await ffmpeg.readFile("audio.mp3");

  // Clean up the in-memory wasm FS so a second upload in the same tab
  // doesn't slowly leak memory.
  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile("audio.mp3").catch(() => {});

  return new Blob([data.buffer], { type: "audio/mp3" });
};
