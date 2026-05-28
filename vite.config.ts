import { createPluginConfig } from "@skyvexsoftware/stratos-sdk/vite";

// BUILD_TARGET=undefined/"ui" → renderer bundle (dist/ui/index.js)
// BUILD_TARGET="background"   → main-process bundle (dist/background/index.js)
// React + the SDK are provided by the Stratos shell at runtime, so they are
// externalised (not bundled) by createPluginConfig.
export default createPluginConfig({
  pluginDir: import.meta.dirname,
  ui: { entry: "src/ui/index.tsx" },
  background: { entry: "src/background/index.ts" },
});
