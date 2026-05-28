// Resolves the SimBrief OFP for the UI with two independent paths:
//   1. the plugin's background route (Node fetch — CORS-immune, preferred)
//   2. a direct browser fetch as a fallback
// Whichever succeeds first wins, so the loadsheet works even if one path is
// blocked (CORS) or unavailable (route not mounted).

import {
  fetchSimbriefOfpById,
  fetchSimbriefOfpByUsername,
  parseSimbriefOfp,
  type SimBriefOfp,
} from "./simbriefOfp";

export type OfpQuery = { ofpId?: string; username?: string };

function hasQuery(q: OfpQuery): boolean {
  return Boolean(q.ofpId || q.username);
}

/** Path 1: ask the background module (no CORS). Returns null on any failure. */
async function viaBackground(
  appBase: string,
  q: OfpQuery,
): Promise<SimBriefOfp | null> {
  const param = q.ofpId
    ? `id=${encodeURIComponent(q.ofpId)}`
    : `username=${encodeURIComponent(q.username!)}`;
  const res = await fetch(`${appBase}/loadsheet/ofp?${param}`);
  if (!res.ok) return null;
  const json = (await res.json()) as SimBriefOfp | null;
  // The background already parsed + normalised to kg.
  return json && typeof json.zfwKg === "number" ? json : null;
}

/** Path 2: fetch SimBrief directly from the renderer (may hit CORS). */
async function viaDirect(q: OfpQuery): Promise<SimBriefOfp | null> {
  if (q.ofpId) return fetchSimbriefOfpById(q.ofpId);
  if (q.username) return fetchSimbriefOfpByUsername(q.username);
  return null;
}

/**
 * Load the OFP, preferring the background route and falling back to a direct
 * fetch. Throws only when BOTH paths fail with a query present.
 */
export async function loadOfp(
  appBase: string,
  q: OfpQuery,
): Promise<SimBriefOfp | null> {
  if (!hasQuery(q)) return null;

  try {
    const bg = await viaBackground(appBase, q);
    if (bg) return bg;
  } catch {
    /* fall through to direct */
  }

  return viaDirect(q);
}

export { parseSimbriefOfp };
