// SimBrief OFP fetch + parse — dependency-free, no external deps.
//
// Normalises all weights/fuel to KG regardless of the OFP's wt_unit.
// Works in both the plugin background (Node) and renderer — uses a plain
// substring extractor instead of DOMParser so there is zero runtime dep.

const LB_TO_KG = 0.453_592_37;

/** Parsed SimBrief OFP weights + fuel plan, all normalised to KG. */
export type SimBriefOfp = {
  blockFuelKg: number; // <fuel><plan_ramp>
  burnKg: number; // <fuel><enroute_burn> (fallback <est_burn>)
  reserveKg: number; // <fuel><reserve>
  zfwKg: number; // <weights><est_zfw>
  towKg: number; // <weights><est_tow>
  ldwKg: number; // <weights><est_ldw>
  maxZfwKg: number; // <weights><max_zfw>  (0 if absent)
  maxTowKg: number; // <weights><max_tow>  (0 if absent)
  maxLdwKg: number; // <weights><max_ldw>  (0 if absent)
  route: string | null;
  alternate: string | null; // <alternate><icao_code>
  flightNumber: string; // <atc><callsign> (fallback <flight_number>)
  originIcao: string; // <origin><icao_code>
  destinationIcao: string; // <destination><icao_code>
  generatedAt: string; // <params><time_generated>
  requestId: string; // <params><request_id> — changes on every re-gen
  paxCount: number; // <weights><pax_count>
  cargoKg: number; // <weights><cargo>
};

/**
 * Return the inner text of the first `<tag>…</tag>` (attributes on the
 * opening tag are tolerated). Returns null when the tag is absent.
 * Mirrors the Rust `extract_tag` helper; pass the result back in to drill
 * into nested elements.
 */
export function extractTag(xml: string, tag: string): string | null {
  const openMatch = new RegExp(`<${tag}(?:\\s[^>]*)?>`).exec(xml);
  if (!openMatch) return null;
  const start = openMatch.index + openMatch[0].length;
  const end = xml.indexOf(`</${tag}>`, start);
  if (end === -1) return null;
  return xml.slice(start, end);
}

function parseNum(xml: string, tag: string, toKg: (v: number) => number): number {
  const raw = extractTag(xml, tag);
  if (raw == null) return 0;
  const n = Number.parseFloat(raw.trim());
  return Number.isFinite(n) ? toKg(n) : 0;
}

/**
 * Parse a SimBrief OFP XML document. Returns null when the OFP is too
 * broken to use (no weight fields at all) — same guard as the Rust port.
 */
export function parseSimbriefOfp(xml: string): SimBriefOfp | null {
  const unitIsLb = extractTag(xml, "wt_unit")?.trim() === "lbs";
  const toKg = (v: number) => (unitIsLb ? v * LB_TO_KG : v);

  const zfwKg = parseNum(xml, "est_zfw", toKg);
  const towKg = parseNum(xml, "est_tow", toKg);
  const ldwKg = parseNum(xml, "est_ldw", toKg);
  if (zfwKg === 0 && towKg === 0 && ldwKg === 0) return null;

  // Trip burn: SimBrief uses <enroute_burn>; fall back to legacy <est_burn>.
  const burnRaw = extractTag(xml, "enroute_burn") ?? extractTag(xml, "est_burn");
  const burnKg = burnRaw ? toKg(Number.parseFloat(burnRaw.trim()) || 0) : 0;

  const weights = extractTag(xml, "weights") ?? "";
  const atc = extractTag(xml, "atc") ?? "";
  const origin = extractTag(xml, "origin") ?? "";
  const destination = extractTag(xml, "destination") ?? "";
  const params = extractTag(xml, "params") ?? "";
  const alternateBlock = extractTag(xml, "alternate") ?? "";

  const paxRaw =
    extractTag(weights, "pax_count") ?? extractTag(weights, "pax_count_actual");
  const cargoRaw = extractTag(weights, "cargo");

  return {
    blockFuelKg: parseNum(xml, "plan_ramp", toKg),
    burnKg,
    reserveKg: parseNum(xml, "reserve", toKg),
    zfwKg,
    towKg,
    ldwKg,
    maxZfwKg: parseNum(xml, "max_zfw", toKg),
    maxTowKg: parseNum(xml, "max_tow", toKg),
    maxLdwKg: parseNum(xml, "max_ldw", toKg),
    route: extractTag(xml, "route")?.trim() || null,
    alternate: extractTag(alternateBlock, "icao_code")?.trim() || null,
    flightNumber:
      extractTag(atc, "callsign")?.trim() ||
      extractTag(xml, "flight_number")?.trim() ||
      "",
    originIcao: extractTag(origin, "icao_code")?.trim() || "",
    destinationIcao: extractTag(destination, "icao_code")?.trim() || "",
    generatedAt:
      extractTag(params, "time_generated")?.trim() ||
      extractTag(xml, "time_generated")?.trim() ||
      "",
    requestId: extractTag(params, "request_id")?.trim() || "",
    paxCount: paxRaw ? Number.parseInt(paxRaw.trim(), 10) || 0 : 0,
    cargoKg: cargoRaw ? toKg(Number.parseFloat(cargoRaw.trim()) || 0) : 0,
  };
}

const OFP_BY_ID_URL = (id: string) =>
  `https://www.simbrief.com/ofp/flightplans/xml/${encodeURIComponent(id)}.xml`;

const OFP_BY_USER_URL = (username: string) =>
  `https://www.simbrief.com/api/xml.fetcher.php?username=${encodeURIComponent(username)}`;

async function fetchOfpXml(url: string): Promise<SimBriefOfp | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return parseSimbriefOfp(await res.text());
}

/** Fetch a SimBrief OFP by its static OFP id (= FlightPlan.sourceId). */
export function fetchSimbriefOfpById(ofpId: string): Promise<SimBriefOfp | null> {
  return fetchOfpXml(OFP_BY_ID_URL(ofpId));
}

/** Fetch the pilot's latest SimBrief OFP by username (settings fallback). */
export function fetchSimbriefOfpByUsername(
  username: string,
): Promise<SimBriefOfp | null> {
  return fetchOfpXml(OFP_BY_USER_URL(username));
}
