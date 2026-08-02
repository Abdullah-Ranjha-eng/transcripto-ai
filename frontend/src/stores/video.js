import { defineStore } from "pinia";
import { ref } from "vue";
import api from "../api/axios.js";
import { uploadVideoToCloudinary } from "../api/cloudinary.js";

export const useVideoStore = defineStore("video", () => {
  const videos = ref([]);
  const currentVideo = ref(null);
  const captions = ref(null);
  const loading = ref(false);
  const error = ref(null);

  // ── Upload state ─────────────────────────────────────────────
  // Separate from `loading`/`error` above on purpose: those describe
  // request/response actions the user explicitly triggers (fetch, burn,
  // translate...). These describe the background video → Cloudinary
  // pipeline kicked off by startUpload, which runs independently of any
  // single request-response cycle and outlives the call that started it.
  const uploadProgress = ref(0);     // 0-100, video → Cloudinary
  const uploadFailed = ref(false);

  // ── Videos ────────────────────────────────────────────────────
  const fetchVideos = async () => {
    loading.value = true;
    try {
      const { data } = await api.get("/videos");
      videos.value = data.videos;
    } catch (err) {
      error.value = err.response?.data?.message || "Failed to load videos.";
    } finally {
      loading.value = false;
    }
  };

  const fetchVideo = async (id) => {
    loading.value = true;
    try {
      const { data } = await api.get(`/videos/${id}`);
      currentVideo.value = data.video;
    } catch (err) {
      error.value = err.response?.data?.message || "Failed to load video.";
    } finally {
      loading.value = false;
    }
  };

  // Same as fetchVideo but never touches `loading` — used for background
  // polling (e.g. Cloudinary sync status) so it can't flicker-disable the
  // Generate/Translate/Burn buttons, which are keyed off `loading`.
  const refreshVideoQuietly = async (id) => {
    try {
      const { data } = await api.get(`/videos/${id}`);
      currentVideo.value = data.video;
    } catch {
      // silent — this is a background poll, not a user-initiated action
    }
  };

  // Creates the video record immediately (no file transferred yet) and
  // returns it so the caller can navigate to the video page right away.
  // Kicks off runVideoUpload in the background (NOT awaited here) so the
  // caller doesn't block on the slow, network-bound video → Cloudinary
  // transfer. Deliberately does NOT start caption generation in parallel —
  // captions only ever start once the video is fully uploaded (gated by
  // videoReady in VideoView.vue), never racing ahead of it. An earlier
  // version extracted audio client-side and transcribed it in parallel with
  // the upload for speed, but that meant captions/translate/burn could
  // appear and be actioned before the underlying video was actually
  // playable — confusing at best, and a source of real ownership/timing
  // bugs at worst. Simpler and correct beats fast-but-surprising here.
  const startUpload = async (file, title) => {
    error.value = null;
    uploadProgress.value = 0;
    uploadFailed.value = false;

    const { data } = await api.post("/videos/init", { title });
    const video = data.video;
    videos.value.unshift(video);
    currentVideo.value = video;

    runVideoUpload(video._id, file);

    return video;
  };

  const runVideoUpload = async (videoId, file) => {
    try {
      const { data: sig } = await api.get("/videos/sign-upload");
      const result = await uploadVideoToCloudinary(file, sig, (p) => {
        uploadProgress.value = p;
      });
      const { data } = await api.put(`/videos/${videoId}/finalize`, {
        public_id: result.public_id,
        url: result.secure_url,
        duration: result.duration,
      });
      _syncVideo(videoId, data.video);
      uploadProgress.value = 100;
    } catch (err) {
      uploadFailed.value = true;
      error.value = err.response?.data?.message || "Video upload failed.";
    }
  };

  // Keeps `videos` list and `currentVideo` (if it's the same video) in sync
  // after a background pipeline updates a record the user may have
  // navigated away from.
  const _syncVideo = (videoId, updatedVideo) => {
    if (currentVideo.value?._id === videoId) currentVideo.value = updatedVideo;
    const idx = videos.value.findIndex((v) => v._id === videoId);
    if (idx !== -1) videos.value[idx] = updatedVideo;
  };

  const deleteVideo = async (id) => {
    try {
      await api.delete(`/videos/${id}`);
      videos.value = videos.value.filter((v) => v._id !== id);
      if (currentVideo.value?._id === id) currentVideo.value = null;
    } catch (err) {
      error.value = err.response?.data?.message || "Delete failed.";
    }
  };

  // ── Captions ──────────────────────────────────────────────────
  const generateCaptions = async (videoId) => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await api.post(`/videos/${videoId}/captions`);
      captions.value = data.captions;
      if (currentVideo.value) currentVideo.value.status = "captioned";
      return true;
    } catch (err) {
      error.value = err.response?.data?.message || "Caption generation failed.";
      return false;
    } finally {
      loading.value = false;
    }
  };

  const fetchCaptions = async (videoId) => {
    try {
      const { data } = await api.get(`/videos/${videoId}/captions`);
      captions.value = data.captions;
    } catch {
      captions.value = null;
    }
  };

  const updateCaptions = async (videoId, captionsArray) => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await api.put(`/videos/${videoId}/captions`, {
        captions: captionsArray,
      });
      captions.value = data.captions;
      return true;
    } catch (err) {
      error.value = err.response?.data?.message || "Update failed.";
      return false;
    } finally {
      loading.value = false;
    }
  };

  const translateCaptions = async (videoId, targetLanguage) => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await api.post(`/videos/${videoId}/translate`, {
        targetLanguage,
      });
      captions.value = data.captions;
      if (currentVideo.value) currentVideo.value.status = "translated";
      return true;
    } catch (err) {
      error.value = err.response?.data?.message || "Translation failed.";
      return false;
    } finally {
      loading.value = false;
    }
  };

  const burnCaptions = async (videoId, language = null) => {
    loading.value = true;
    error.value = null;
    try {
      const body = language ? { language } : {};
      const { data } = await api.post(`/videos/${videoId}/captions/burn`, body);
      if (currentVideo.value) {
        currentVideo.value.burnedVideo = data.burnedVideo;
        currentVideo.value.status = "burned";
      }
      return data.burnedVideo;
    } catch (err) {
      error.value = err.response?.data?.message || "Burn failed.";
      return null;
    } finally {
      loading.value = false;
    }
  };

  const downloadCaptions = (videoId, format = "srt", language = null) => {
    // let url = `http://localhost:5000/api/v1/videos/${videoId}/captions/download?format=${format}`;
    const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1";
    let url = `${apiBase}/videos/${videoId}/captions/download?format=${format}`;
    if (language) url += `&language=${language}`;
    window.open(url, "_blank");
  };

  return {
    videos, currentVideo, captions, loading, error,
    uploadProgress, uploadFailed,
    fetchVideos, fetchVideo, refreshVideoQuietly, startUpload, deleteVideo,
    generateCaptions, fetchCaptions, updateCaptions,
    translateCaptions, burnCaptions, downloadCaptions,
  };
});