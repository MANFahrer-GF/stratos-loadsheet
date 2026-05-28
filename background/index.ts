import { createPlugin } from "@skyvexsoftware/stratos-sdk/helpers";

// This plugin is UI-only: all work (OFP fetch + loadsheet compare) happens
// in the renderer via the hooks in ../ui/index.tsx. The background module
// exists only to satisfy the plugin contract and for lifecycle logging.
export default createPlugin({
  async onStart(ctx) {
    ctx.logger.info("Loadsheet", "Stratos Loadsheet plugin started");
  },
  async onStop(ctx) {
    ctx.logger.info("Loadsheet", "Stratos Loadsheet plugin stopped");
  },
});
