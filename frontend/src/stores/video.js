import { defineStore } from "pinia";
import { ref } from "vue";
import api from "../api/axios.js";

export const useVideoStore = defineStore("video", () => {
  const videos = ref([]);
  const currentVideo = ref(null);
  const captions = ref(null);
  const loading = ref(false);
  const error = ref(null);

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

  const uploadVideo = async (formData, onProgress) => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await api.post("/videos/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      videos.value.unshift(data.video);
      return data.video;
    } catch (err) {
      error.value = err.response?.data?.message || "Upload failed.";
      return null;
    } finally {
      loading.value = false;
    }
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
    fetchVideos, fetchVideo, refreshVideoQuietly, uploadVideo, deleteVideo,
    generateCaptions, fetchCaptions, updateCaptions,
    translateCaptions, burnCaptions, downloadCaptions,
  };
});