import axios from "axios";
import express from "express";

// Plain axios — NOT the app's `api` client (src/api/axios.js). This goes
// straight to Cloudinary, so it must not carry our auth cookie or use our
// backend's baseURL/withCredentials config.
export const uploadVideoToCloudinary = async (file, sig, onProgress) => {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sig.apiKey);
  form.append("timestamp", sig.timestamp);
  form.append("signature", sig.signature);
  form.append("folder", sig.folder);

  const { data } = await axios.post(
    `https://api.cloudinary.com/v1_1/${sig.cloudName}/video/upload`,
    form,
    {
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    }
  );

  return data; // { public_id, secure_url, duration, ... }
};
