import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "child_process";

function fetchScores() {
  return {
    name: "fetch-scores",
    hooks: {
      "astro:build:start": () => {
        if (process.env.GOLFCANADA_USERNAME && process.env.GOLFCANADA_PASSWORD) {
          try {
            execSync("npm run fetch-scores", { stdio: "inherit" });
          } catch (err) {
            throw new Error(`Failed to fetch Golf Canada scores: ${err instanceof Error ? err.message : err}`);
          }
        }
      },
    },
  };
}

export default defineConfig({
  integrations: [react(), fetchScores()],
  vite: {
    plugins: [tailwindcss()],
  },
});
