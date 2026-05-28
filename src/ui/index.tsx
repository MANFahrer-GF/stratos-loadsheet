import { useEffect, useRef, useState } from "react";
// Import from the bare specifier — the Stratos shell provides this module at
// runtime (window.__stratos_modules__), so hooks share the shell's React
// context + query client. Subpath imports would bundle a second SDK copy.
import {
  useTrackingSession,
  useSimData,
  useShellConfig,
  useFlightEvents,
  STRATOS_APP_BASE,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
} from "@skyvexsoftware/stratos-sdk";
import {
  buildLoadsheet,
  lbsToKg,
  type Loadsheet,
  type LoadsheetCell,
  type Severity,
} from "../loadsheet";
import { loadOfp } from "../ofpLoader";
import type { SimBriefOfp } from "../simbriefOfp";

const CELL_LABEL: Record<LoadsheetCell["label"], string> = {
  block: "Block",
  zfw: "ZFW",
  tow: "TOW",
};

const SEVERITY_VARIANT: Record<Severity, "default" | "secondary" | "destructive"> = {
  ok: "secondary",
  warn: "default",
  alert: "destructive",
};

const fmtKg = (v: number | null) =>
  v == null ? "—" : `${Math.round(v).toLocaleString("de-DE")} kg`;

const fmtDelta = (v: number) =>
  `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("de-DE")}`;

function hintText(ls: Loadsheet): string | null {
  switch (ls.hint.kind) {
    case "ready":
      return "Loadsheet passt — startklar.";
    case "fueling":
      return `Noch ${ls.hint.amountKg?.toLocaleString("de-DE")} kg nachtanken.`;
    case "boarding":
      return `Noch ${ls.hint.amountKg?.toLocaleString("de-DE")} kg Zuladung fehlt.`;
    case "overfueled":
      return `${ls.hint.amountKg?.toLocaleString("de-DE")} kg mehr getankt als geplant.`;
    default:
      return ls.ofpLooksOutdated
        ? "OFP wirkt veraltet — neu planen und ggf. erneut starten."
        : null;
  }
}

/** Build the one-line summary written into the PIREP at block-off. */
function pirepSummary(ls: Loadsheet): string {
  const part = (c: LoadsheetCell) => {
    const v = fmtKg(c.istKg);
    if (c.istKg == null) return null;
    const plan =
      c.sollKg != null && c.deltaKg != null
        ? ` (Plan ${fmtKg(c.sollKg)}, Δ ${fmtDelta(c.deltaKg)})`
        : "";
    const ow = c.overweight ? " ⚠OVERWEIGHT" : "";
    return `${CELL_LABEL[c.label]} ${v}${plan}${ow}`;
  };
  const body = ls.cells.map(part).filter(Boolean).join(" · ");
  return `Loadsheet @ Block-off — ${body}`;
}

// Phases that mean "we have left the gate" → freeze + write the loadsheet.
const BLOCK_OFF_PHASES = new Set(["taxi", "take_off", "climb", "cruise"]);

/** Root component for the Stratos Loadsheet plugin. */
export default function LoadsheetPlugin() {
  const { currentFlight, phase } = useTrackingSession();
  const config = useShellConfig();
  const { addComment } = useFlightEvents();
  const username = config.get<string>("simbriefUsername", "");

  // Live aircraft weights (lbs, canonical) — re-renders only when these change.
  const live = useSimData({
    select: (s) => ({
      fuelLb: s.data?.fuelTotalQuantityWeight ?? null,
      zfwLb: s.data?.zeroWeightPlusPayload ?? null,
      onGround: s.data?.planeOnground ?? null,
    }),
  }).data;

  const [ofp, setOfp] = useState<SimBriefOfp | null>(null);
  const [ofpError, setOfpError] = useState<string | null>(null);

  const plan = currentFlight?.flightPlan;
  const ofpId = plan?.source === "simbrief" ? plan.sourceId : undefined;
  const flightId =
    currentFlight?.stratosFlightId ?? currentFlight?.vaTrackingId ?? null;

  // Resolve the OFP (background route → direct fallback) when the flight or
  // SimBrief username changes.
  useEffect(() => {
    let cancelled = false;
    setOfpError(null);
    setOfp(null);
    if (!ofpId && !username) return;
    void (async () => {
      try {
        const result = await loadOfp(STRATOS_APP_BASE, { ofpId, username });
        if (!cancelled) {
          setOfp(result);
          if (!result) setOfpError("Kein OFP gefunden.");
        }
      } catch {
        if (!cancelled) setOfpError("SimBrief-OFP konnte nicht geladen werden.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ofpId, username]);

  // Live IST in kg.
  const blockFuelKg = live.fuelLb != null && live.fuelLb > 0 ? lbsToKg(live.fuelLb) : null;
  const zfwKg = live.zfwLb != null && live.zfwLb > 0 ? lbsToKg(live.zfwLb) : null;
  const towKg = blockFuelKg != null && zfwKg != null ? blockFuelKg + zfwKg : null;

  const ls = buildLoadsheet({ blockFuelKg, zfwKg, towKg }, ofp);

  // Write the loadsheet into the PIREP once, at block-off (as a pilot comment
  // → persisted with the PIREP). Guarded per flight so it fires exactly once.
  const sentForFlight = useRef<string | null>(null);
  useEffect(() => {
    if (!flightId || sentForFlight.current === flightId) return;
    if (!BLOCK_OFF_PHASES.has(phase)) return;
    if (blockFuelKg == null && zfwKg == null) return; // no data yet
    addComment(pirepSummary(ls));
    sentForFlight.current = flightId;
  }, [phase, flightId, blockFuelKg, zfwKg, ls, addComment]);

  if (!currentFlight) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stratos Loadsheet</CardTitle>
        </CardHeader>
        <CardContent>Kein aktiver Flug. Starte einen Flug, um das Loadsheet zu sehen.</CardContent>
      </Card>
    );
  }

  const noSim = live.fuelLb == null && live.zfwLb == null;
  const hint = hintText(ls);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Stratos Loadsheet{ofp?.flightNumber ? ` — ${ofp.flightNumber}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {noSim && <p style={{ marginBottom: 8 }}>Warte auf Sim-Daten…</p>}
        {!ofp && !noSim && (
          <p style={{ marginBottom: 8 }}>
            {ofpError ??
              (ofpId || username
                ? "OFP wird geladen…"
                : "Kein SimBrief-OFP verknüpft. Trage deinen SimBrief-Usernamen in den Plugin-Einstellungen ein.")}
          </p>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          {ls.cells.map((c) => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 56, fontWeight: 600 }}>{CELL_LABEL[c.label]}</span>
              <span style={{ fontFamily: "monospace", minWidth: 110 }}>{fmtKg(c.istKg)}</span>
              <span style={{ opacity: 0.6, fontFamily: "monospace" }}>Plan {fmtKg(c.sollKg)}</span>
              {c.deltaKg != null && (
                <Badge variant={SEVERITY_VARIANT[c.severity]}>
                  {c.overweight ? "⚠ " : ""}
                  {fmtDelta(c.deltaKg)} kg
                </Badge>
              )}
            </div>
          ))}
        </div>

        {hint && <p style={{ marginTop: 12 }}>{hint}</p>}
      </CardContent>
    </Card>
  );
}
