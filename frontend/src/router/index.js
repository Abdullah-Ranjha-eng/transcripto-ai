import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const routes = [
  { path: "/",          name: "Home",      component: () => import("../views/HomeView.vue") },
  { path: "/login",     name: "Login",     component: () => import("../views/LoginView.vue") },
  { path: "/register",  name: "Register",  component: () => import("../views/RegisterView.vue") },
  { path: "/dashboard", name: "Dashboard", component: () => import("../views/DashboardView.vue"), meta: { requiresAuth: true } },
  { path: "/upload",    name: "Upload",    component: () => import("../views/UploadView.vue"),    meta: { requiresAuth: true } },
  { path: "/video/:id", name: "Video",     component: () => import("../views/VideoView.vue"),     meta: { requiresAuth: true } },
  { path: "/about",     name: "About",     component: () => import("../views/AboutView.vue") },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0, behavior: "smooth" };
  },
});

// Fallback for scrollable div containers
router.afterEach(() => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.user) await auth.fetchProfile();
  if (to.meta.requiresAuth && !auth.user) return { name: "Login" };
});

export default router;