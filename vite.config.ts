import { createPluginConfig } from "@skyvexsoftware/stratos-sdk/vite";
import react from "@vitejs/plugin-react";

// BUILD_TARGET=undefined/"ui" → renderer bundle (dist/ui/index.js)
// BUILD_TARGET="background"   → main-process bundle (dist/background/index.js)
// React + the SDK are provided by the Stratos shell at runtime, so they are
// externalised (not bundled) by createPluginConfig.
//
// @vitejs/plugin-react serves the /@react-refresh runtime that the SDK's dev
// preamble imports — without it the UI module fails to load in dev mode.
export default createPluginConfig({
  pluginDir: import.meta.dirname,
  ui: { entry: "src/ui/index.tsx" },
  background: { entry: "src/background/index.ts" },
  vite: { plugins: [react()] },
});
