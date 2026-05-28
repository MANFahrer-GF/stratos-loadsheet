import { createPlugin } from "@skyvexsoftware/stratos-sdk/helpers";
import express from "express";
import {
  fetchSimbriefOfpById,
  fetchSimbriefOfpByUsername,
} from "../simbriefOfp";

// The OFP fetch runs HERE (Electron main / Node) — not in the renderer — so
// it is immune to browser CORS. The UI calls GET /loadsheet/ofp on the local
// Stratos server; this router fetches + parses SimBrief and returns JSON.
export default createPlugin({
  async onStart(ctx) {
    const router = express.Router();

    router.get("/ofp", async (req, res) => {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      const username =
        typeof req.query.username === "string" ? req.query.username : "";
      try {
        const ofp = id
          ? await fetchSimbriefOfpById(id)
          : username
            ? await fetchSimbriefOfpByUsername(username)
            : null;
        res.json(ofp);
      } catch (err) {
        ctx.logger.warn("Loadsheet", `OFP fetch failed: ${String(err)}`);
        res.status(502).json({ error: "simbrief_fetch_failed" });
      }
    });

    ctx.server.registerRouter("/loadsheet", router);
    ctx.logger.info("Loadsheet", "Stratos Loadsheet plugin started");
  },
  async onStop(ctx) {
    ctx.logger.info("Loadsheet", "Stratos Loadsheet plugin stopped");
  },
});
