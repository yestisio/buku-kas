import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PENTING untuk GitHub Pages (project site, bukan user/organization site):
// base harus "/nama-repo-kamu/" (perhatikan garis miring di awal & akhir).
// Kalau nanti nama repo-nya bukan "buku-kas", ganti nilai di bawah.
export default defineConfig({
  plugins: [react()],
  base: "/buku-kas/",
});

