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
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
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
  v == null ? "—" : `${Math.round(v).toLocaleString("en-US")} kg`;

const fmtDelta = (v: number) =>
  `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("en-US")}`;

function hintText(ls: Loadsheet): string | null {
  switch (ls.hint.kind) {
    case "ready":
      return "Loadsheet matches — ready to go.";
    case "fueling":
      return `Add ${ls.hint.amountKg?.toLocaleString("en-US")} kg more fuel.`;
    case "boarding":
      return `${ls.hint.amountKg?.toLocaleString("en-US")} kg of payload still to load.`;
    case "overfueled":
      return `${ls.hint.amountKg?.toLocaleString("en-US")} kg more fuel than planned.`;
    default:
      return ls.ofpLooksOutdated
        ? "OFP looks outdated — re-plan and restart if needed."
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

/** Root component for the Loadsheet plugin. */
export default function LoadsheetPlugin() {
  const { currentFlight, phase } = useTrackingSession();
  const config = useShellConfig();
  const { addComment } = useFlightEvents();
  const username = config.get<string>("simbriefUsername", "");

  // Live aircraft weights (lbs, canonical) — re-renders only when these change.
  // `data` is undefined until the first sim snapshot hydrates, so default it.
  const live = useSimData({
    select: (s) => ({
      fuelLb: s?.data?.fuelTotalQuantityWeight ?? null,
      zfwLb: s?.data?.zeroWeightPlusPayload ?? null,
      onGround: s?.data?.planeOnground ?? null,
    }),
  }).data ?? { fuelLb: null, zfwLb: null, onGround: null };

  const [ofp, setOfp] = useState<SimBriefOfp | null>(null);
  const [ofpError, setOfpError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped by the Refresh button to force a re-fetch of the OFP.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const plan = currentFlight?.flightPlan;
  const ofpId = plan?.source === "simbrief" ? plan.sourceId : undefined;
  const flightId =
    currentFlight?.stratosFlightId ?? currentFlight?.vaTrackingId ?? null;
  const canLoadOfp = Boolean(ofpId || username);

  // Resolve the OFP (background route → direct fallback) on flight/username
  // change and on manual refresh. A manual refresh (nonce > 0) prefers the
  // latest OFP via username when available, so re-planning in SimBrief is
  // picked up without restarting the flight.
  useEffect(() => {
    let cancelled = false;
    if (!canLoadOfp) {
      setOfp(null);
      return;
    }
    setRefreshing(true);
    setOfpError(null);
    const query =
      refreshNonce > 0 && username ? { username } : { ofpId, username };
    void (async () => {
      try {
        const result = await loadOfp(STRATOS_APP_BASE, query);
        if (!cancelled) {
          setOfp(result);
          if (!result) setOfpError("No OFP found.");
        }
      } catch {
        if (!cancelled) setOfpError("Could not load SimBrief OFP.");
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ofpId, username, refreshNonce, canLoadOfp]);

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
          <CardTitle>Loadsheet</CardTitle>
        </CardHeader>
        <CardContent>No active flight. Start a flight to see the loadsheet.</CardContent>
      </Card>
    );
  }

  const noSim = live.fuelLb == null && live.zfwLb == null;
  const hint = hintText(ls);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Loadsheet{ofp?.flightNumber ? ` — ${ofp.flightNumber}` : ""}
        </CardTitle>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={refreshing || !canLoadOfp}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {noSim && <p style={{ marginBottom: 8 }}>Waiting for sim data…</p>}
        {!ofp && !noSim && (
          <p style={{ marginBottom: 8 }}>
            {ofpError ??
              (ofpId || username
                ? "Loading OFP…"
                : "No SimBrief OFP linked. Enter your SimBrief username in the plugin settings.")}
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
