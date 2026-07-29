<template>
  <main class="max-w-5xl mx-auto px-6 pt-32 pb-16">
    <LoadingSpinner v-if="store.loading && !store.currentVideo" />

    <template v-else-if="store.currentVideo">
      <div class="flex items-center gap-3 mb-6">
        <RouterLink to="/dashboard" class="text-sm text-gray-500 hover:text-white">← Dashboard</RouterLink>
        <span class="text-gray-700">/</span>
        <h1 class="text-xl font-bold truncate">{{ store.currentVideo.title }}</h1>
        <span class="text-xs px-2 py-0.5 rounded-full ml-auto" :class="statusClass(store.currentVideo.status)">
          {{ store.currentVideo.status }}
        </span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <!-- Left: video player -->
        <div class="space-y-4">
          <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden aspect-video">
            <video v-if="activeVideoUrl" :src="activeVideoUrl" controls class="w-full h-full object-contain" />
            <div v-else-if="isThisVideoUploading" class="w-full h-full flex flex-col items-center justify-center gap-3 px-8">
              <span class="text-3xl">📤</span>
              <div class="w-full max-w-xs">
                <div class="flex justify-between text-xs text-gray-400 mb-1.5">
                  <span>Uploading video…</span>
                  <span class="font-semibold text-indigo-400">{{ store.uploadProgress }}%</span>
                </div>
                <div class="w-full rounded-full h-2 overflow-hidden bg-gray-800">
                  <div class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-200"
                    :style="{ width: store.uploadProgress + '%' }"></div>
                </div>
              </div>
              <p class="text-xs text-gray-600 text-center">Once this finishes, you can generate captions.</p>
            </div>
            <div v-else-if="store.uploadFailed" class="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-8">
              <span class="text-3xl">⚠️</span>
              <p class="text-sm text-red-400">Video upload failed. Please delete this and try again.</p>
            </div>
            <div v-else class="w-full h-full flex items-center justify-center text-gray-600 text-4xl">🎬</div>
          </div>

          <!-- Background cloud sync indicator (video already plays locally, this is just informational) -->
          <p v-if="activeCloudStatus === 'uploading' || activeCloudStatus === 'pending'"
            class="text-xs text-gray-500 flex items-center gap-1.5">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
            Saving to cloud storage in the background…
          </p>

          <!-- Toggle burned / original -->
          <div v-if="store.currentVideo.burnedVideo?.url" class="flex gap-2">
            <button @click="showBurned = false"
              :class="!showBurned ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'"
              class="flex-1 py-2 rounded-lg text-sm font-medium transition">Original</button>
            <button @click="showBurned = true"
              :class="showBurned ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'"
              class="flex-1 py-2 rounded-lg text-sm font-medium transition">Burned ✅</button>
          </div>

          <!-- Action buttons -->
          <div class="grid grid-cols-2 gap-2">
            <!-- Strictly sequential: this is disabled until the upload
                 itself has finished (isThisVideoUploading is false), and
                 Translate/Burn below don't appear at all until captions
                 exist. -->
            <button v-if="!store.captions" @click="handleGenerate"
              :disabled="store.loading || isThisVideoUploading"
              :title="isThisVideoUploading ? 'Waiting for the video upload to finish…' : ''"
              class="col-span-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg py-2.5 text-sm font-semibold transition">
              {{ isThisVideoUploading ? "Waiting for upload…" : (store.loading && step === 'generate' ? "Generating…" : "🎙️ Generate Captions") }}
            </button>

            <template v-if="store.captions">
              <!-- Translate -->
              <div class="col-span-2 flex gap-2">
                <select v-model="targetLang" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select language…</option>
                  <option v-for="l in LANGUAGES" :key="l">{{ l }}</option>
                </select>
                <button @click="handleTranslate"
                  :disabled="!targetLang || store.loading"
                  class="px-4 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 rounded-lg text-sm font-semibold transition">
                  {{ store.loading && step === 'translate' ? "…" : "Translate" }}
                </button>
              </div>

              <!-- Burn -->
              <button @click="handleBurn"
                :disabled="store.loading"
                class="bg-orange-700 hover:bg-orange-600 disabled:opacity-40 rounded-lg py-2.5 text-sm font-semibold transition">
                {{ store.loading && step === 'burn' ? "Burning…" : "🔥 Burn Captions" }}
              </button>

              <!-- Download -->
              <div class="relative" ref="dlMenu">
                <button @click="showDlMenu = !showDlMenu"
                  class="w-full bg-gray-800 hover:bg-gray-700 rounded-lg py-2.5 text-sm font-semibold transition">
                  📥 Download ▾
                </button>
                <div v-if="showDlMenu"
                  class="absolute right-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden z-10 shadow-xl">
                  <button @click="dl('srt')"    class="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-700">Download SRT</button>
                  <button @click="dl('txt')"    class="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-700">Download TXT</button>
                  <template v-if="targetLang">
                    <div class="border-t border-gray-700 my-1"></div>
                    <button @click="dl('srt', targetLang)" class="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-700">{{ targetLang }} SRT</button>
                    <button @click="dl('txt', targetLang)" class="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-700">{{ targetLang }} TXT</button>
                  </template>
                </div>
              </div>
            </template>
          </div>

          <p v-if="store.error" class="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
            {{ store.error }}
          </p>
          <p v-if="successMsg" class="text-sm text-green-400 bg-green-900/20 border border-green-800 rounded-lg px-3 py-2">
            {{ successMsg }}
          </p>
        </div>

        <!-- Right: caption editor -->
        <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-semibold text-sm text-gray-300">Caption Editor</h2>
            <button v-if="store.captions && captionsEdited"
              @click="handleSave"
              :disabled="store.loading"
              class="text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg font-medium transition">
              Save Changes
            </button>
          </div>

          <p v-if="!store.captions" class="text-gray-600 text-sm text-center my-auto">
            Generate captions to see them here.
          </p>

          <div v-else class="overflow-y-auto flex-1 space-y-2 max-h-[500px] pr-1">
            <div v-for="(cap, i) in editableCaptions" :key="i"
              class="bg-gray-800 rounded-xl p-3 flex gap-3 items-start">
              <span class="text-xs text-gray-500 shrink-0 mt-0.5 w-8 text-right">{{ i + 1 }}</span>
              <div class="flex-1 min-w-0">
                <div class="text-xs text-indigo-400 mb-1">
                  {{ fmtTime(cap.start) }} → {{ fmtTime(cap.end) }}
                </div>
                <textarea v-model="cap.text" rows="2"
                  class="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  @input="captionsEdited = true" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <p v-else class="text-center text-gray-500 py-20">Video not found.</p>
  </main>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useRoute } from "vue-router";
import { useVideoStore } from "../stores/video.js";
import LoadingSpinner from "../components/LoadingSpinner.vue";

const store = useVideoStore();
const route = useRoute();
const videoId = route.params.id;

const LANGUAGES = ["Arabic","French","Spanish","German","English","Urdu","Hindi","Chinese","Turkish","Russian","Italian","Portuguese","Japanese"];

const showBurned = ref(false);
const targetLang = ref("");
const step = ref("");
const successMsg = ref("");
const showDlMenu = ref(false);
const captionsEdited = ref(false);
const editableCaptions = ref([]);

const activeVideoUrl = computed(() =>
  showBurned.value
    ? store.currentVideo?.burnedVideo?.url
    : store.currentVideo?.originalVideo?.url
);

const activeCloudStatus = computed(() =>
  showBurned.value
    ? store.currentVideo?.burnedVideo?.cloudStatus
    : store.currentVideo?.originalVideo?.cloudStatus
);

// True only while THIS video (not some other one the store might still be
// tracking from a prior upload) is mid-upload — i.e. we navigated here
// straight from the upload form and runVideoUpload hasn't finalized yet.
const isThisVideoUploading = computed(() =>
  store.currentVideo?._id === videoId &&
  store.currentVideo?.status === "uploading" &&
  !activeVideoUrl.value
);

// Poll while either asset is still syncing to Cloudinary in the background,
// so the badge above clears and the URL swaps over automatically once done.
let pollTimer = null;
const startPollingIfNeeded = () => {
  const stillSyncing = ["pending", "uploading"].includes(store.currentVideo?.originalVideo?.cloudStatus)
    || ["pending", "uploading"].includes(store.currentVideo?.burnedVideo?.cloudStatus);

  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (!stillSyncing) return;

  pollTimer = setInterval(async () => {
    await store.refreshVideoQuietly(videoId);
    const done = !["pending", "uploading"].includes(store.currentVideo?.originalVideo?.cloudStatus)
      && !["pending", "uploading"].includes(store.currentVideo?.burnedVideo?.cloudStatus);
    if (done && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }, 4000);
};

watch(() => store.currentVideo?.status, startPollingIfNeeded);

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
};

const statusClass = (s) => ({
  uploading:  "bg-indigo-900 text-indigo-300",
  uploaded:   "bg-gray-700 text-gray-300",
  processing: "bg-yellow-800 text-yellow-300",
  captioned:  "bg-blue-800 text-blue-300",
  translated: "bg-purple-800 text-purple-300",
  burned:     "bg-green-800 text-green-300",
}[s] || "bg-gray-700 text-gray-300");

watch(() => store.captions, (val) => {
  if (val) {
    editableCaptions.value = val.captions.map((c) => ({ ...c }));
    captionsEdited.value = false;
  }
});

const flash = (msg) => {
  successMsg.value = msg;
  setTimeout(() => { successMsg.value = ""; }, 4000);
};

const handleGenerate = async () => {
  step.value = "generate";
  const ok = await store.generateCaptions(videoId);
  if (ok) flash("Captions generated successfully!");
};

const handleTranslate = async () => {
  if (!targetLang.value) return;
  step.value = "translate";
  const ok = await store.translateCaptions(videoId, targetLang.value);
  if (ok) flash(`Translated to ${targetLang.value}!`);
};

const handleBurn = async () => {
  step.value = "burn";
  const lang = targetLang.value || null;
  const result = await store.burnCaptions(videoId, lang);
  if (result) {
    showBurned.value = true;
    flash("Captions burned into video!");
  }
};

const handleSave = async () => {
  const ok = await store.updateCaptions(videoId, editableCaptions.value);
  if (ok) { captionsEdited.value = false; flash("Captions saved!"); }
};

const dl = (format, lang = null) => {
  store.downloadCaptions(videoId, format, lang);
  showDlMenu.value = false;
};

// close dropdown on outside click
const dlMenu = ref(null);
const onClickOutside = (e) => {
  if (dlMenu.value && !dlMenu.value.contains(e.target)) showDlMenu.value = false;
};

onMounted(async () => {
  // If we just came from the upload form, store.currentVideo for this
  // exact id is already live and being updated in place by the background
  // upload — re-fetching here is harmless but unnecessary, and skipping it
  // avoids a redundant round-trip right after navigation.
  const alreadyTracking = store.currentVideo?._id === videoId;
  if (!alreadyTracking) {
    await store.fetchVideo(videoId);
    await store.fetchCaptions(videoId);
  }
  document.addEventListener("click", onClickOutside);
  startPollingIfNeeded();
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onClickOutside);
  if (pollTimer) clearInterval(pollTimer);
});
</script>