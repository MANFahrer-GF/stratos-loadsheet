// Loadsheet IST/SOLL comparison — pure delta + hint logic. No React, no
// i18n, no SDK: returns severity enums and hint keys so the UI layer owns
// rendering + translation.
//
// All inputs are in KG. Convert Stratos' lbs values at the boundary
// (Stratos canonical weight unit is lbs).

import type { SimBriefOfp } from "./simbriefOfp";

export const LB_TO_KG = 0.453_592_37;
export const lbsToKg = (lbs: number): number => lbs * LB_TO_KG;

export type Severity = "ok" | "warn" | "alert";

/** One loadsheet row (Block / ZFW / TOW). */
export type LoadsheetCell = {
  label: "block" | "zfw" | "tow";
  istKg: number | null;
  sollKg: number | null;
  maxKg: number | null;
  deltaKg: number | null;
  deltaPct: number | null;
  severity: Severity;
  overweight: boolean;
};

/** Actual weights captured at block-off (already converted to kg). */
export type LoadsheetActual = {
  blockFuelKg: number | null;
  zfwKg: number | null;
  towKg: number | null;
};

export type LoadsheetHintKind =
  | "ready"
  | "fueling"
  | "boarding"
  | "overfueled"
  | "none";

export type LoadsheetHint = {
  kind: LoadsheetHintKind;
  /** kg, present for fueling/boarding/overfueled. Always positive. */
  amountKg?: number;
};

export type Loadsheet = {
  cells: LoadsheetCell[];
  hint: LoadsheetHint;
  /** True when the fuel delta looks like the OFP is stale (PreFlight re-plan). */
  ofpLooksOutdated: boolean;
};

function computeCell(
  label: LoadsheetCell["label"],
  istKg: number | null,
  sollKg: number | null,
  maxKg: number | null,
): LoadsheetCell {
  const deltaKg = istKg != null && sollKg != null ? istKg - sollKg : null;
  const deltaPct =
    deltaKg != null && sollKg != null && sollKg !== 0
      ? Math.abs(deltaKg / sollKg) * 100
      : null;

  let severity: Severity = "ok";
  if (deltaPct != null) {
    if (deltaPct >= 10) severity = "alert";
    else if (deltaPct >= 5) severity = "warn";
  }

  const overweight = istKg != null && maxKg != null && maxKg > 0 && istKg > maxKg;
  if (overweight) severity = "alert";

  return { label, istKg, sollKg, maxKg, deltaKg, deltaPct, severity, overweight };
}

function computeHint(
  fuelDelta: number | null,
  zfwDelta: number | null,
): LoadsheetHint {
  if (fuelDelta == null && zfwDelta == null) return { kind: "none" };

  const fuelOk = fuelDelta == null || Math.abs(fuelDelta) < 200;
  const zfwOk = zfwDelta == null || Math.abs(zfwDelta) < 200;
  if (fuelOk && zfwOk) return { kind: "ready" };

  if (fuelDelta != null && fuelDelta < -300)
    return { kind: "fueling", amountKg: Math.abs(Math.round(fuelDelta)) };
  if (zfwDelta != null && zfwDelta < -300)
    return { kind: "boarding", amountKg: Math.abs(Math.round(zfwDelta)) };
  if (fuelDelta != null && fuelDelta > 500)
    return { kind: "overfueled", amountKg: Math.round(fuelDelta) };

  return { kind: "none" };
}

/**
 * OFP-outdated heuristic: a large fuel delta combined with a matching ZFW
 * means the pilot re-planned fuel but pax/cargo are unchanged — i.e. the
 * held OFP is stale, so offer a refresh.
 */
export function ofpLooksOutdated(
  fuelDelta: number | null,
  zfwDelta: number | null,
  plannedBlockKg: number | null,
): boolean {
  if (fuelDelta == null || plannedBlockKg == null) return false;
  const pct = plannedBlockKg > 0 ? Math.abs(fuelDelta / plannedBlockKg) * 100 : null;
  const fuelLooksOutdated =
    Math.abs(fuelDelta) >= 400 || (pct != null && pct >= 5);
  const zfwLooksMatching = zfwDelta == null || Math.abs(zfwDelta) < 200;
  return fuelLooksOutdated && zfwLooksMatching;
}

/** Build the full loadsheet comparison from actuals + a parsed OFP. */
export function buildLoadsheet(
  actual: LoadsheetActual,
  ofp: SimBriefOfp | null,
): Loadsheet {
  const plannedBlock = ofp?.blockFuelKg ?? null;
  const plannedZfw = ofp?.zfwKg ?? null;
  const plannedTow = ofp?.towKg ?? null;
  const maxZfw = ofp?.maxZfwKg && ofp.maxZfwKg > 0 ? ofp.maxZfwKg : null;
  const maxTow = ofp?.maxTowKg && ofp.maxTowKg > 0 ? ofp.maxTowKg : null;

  const cells = [
    computeCell("block", actual.blockFuelKg, plannedBlock, null),
    computeCell("zfw", actual.zfwKg, plannedZfw, maxZfw),
    computeCell("tow", actual.towKg, plannedTow, maxTow),
  ];

  const fuelDelta =
    actual.blockFuelKg != null && plannedBlock != null
      ? actual.blockFuelKg - plannedBlock
      : null;
  const zfwDelta =
    actual.zfwKg != null && plannedZfw != null ? actual.zfwKg - plannedZfw : null;

  return {
    cells,
    hint: computeHint(fuelDelta, zfwDelta),
    ofpLooksOutdated: ofpLooksOutdated(fuelDelta, zfwDelta, plannedBlock),
  };
}
