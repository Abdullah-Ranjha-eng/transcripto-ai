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

  // Upload is still: create the record instantly, navigate to the video
  // page right away, and upload the file straight to Cloudinary in the
  // background (no server proxy) — so the user isn't stuck staring at the
  // upload form. What's gone is the parallel client-side audio
  // transcription: captions are now strictly sequential — "Generate
  // Captions" only becomes usable once the upload itself has finished
  // (see isThisVideoUploading in VideoView.vue), and Translate/Burn only
  // appear once captions exist.
  const uploadProgress = ref(0); // 0-100, video → Cloudinary
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
  // The actual upload to Cloudinary runs in runVideoUpload, not awaited
  // here — the video page shows its progress via uploadProgress.
  const startUpload = async (file, title) => {
    error.value = null;
    uploadProgress.value = 0;
    uploadFailed.value = false;
    // Without this, captions left over from whatever video was last viewed
    // in this session stay in the store, and since Translate/Burn are
    // gated purely on `store.captions` being truthy, they'd incorrectly
    // unlock immediately — even though this new video hasn't been
    // transcribed (or even finished uploading) yet.
    captions.value = null;

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
  // after the background upload updates a record the user may have
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
