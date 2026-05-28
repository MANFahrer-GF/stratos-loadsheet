import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  CardDescription,
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

const SEVERITY_DOT: Record<Severity, string> = {
  ok: "#22c55e",
  warn: "#f59e0b",
  alert: "#ef4444",
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
  // The plugin's own declared setting (fallback).
  const pluginUsername = config.get<string>("simbriefUsername", "");
  // The shell's GLOBAL SimBrief username (Settings → "SimBrief Username",
  // shared across plugins), read from the local app config endpoint. This is
  // the value most users set, so prefer it; fall back to the plugin setting.
  const [shellUsername, setShellUsername] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`${STRATOS_APP_BASE}/api/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const u = j?.data?.simbriefUsername;
        if (!cancelled && typeof u === "string") setShellUsername(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const username = shellUsername || pluginUsername;

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
      <Card style={{ width: "100%", maxWidth: "none" }}>
        <CardHeader>
          <CardTitle>Loadsheet</CardTitle>
        </CardHeader>
        <CardContent>No active flight. Start a flight to see the loadsheet.</CardContent>
      </Card>
    );
  }

  const noSim = live.fuelLb == null && live.zfwLb == null;
  const hint = hintText(ls);
  const subtitle =
    ofp?.originIcao && ofp?.destinationIcao
      ? `${ofp.originIcao} → ${ofp.destinationIcao}`
      : null;
  const worst: Severity = ls.cells.some((c) => c.severity === "alert")
    ? "alert"
    : ls.cells.some((c) => c.severity === "warn")
      ? "warn"
      : "ok";
  const statusMsg = noSim
    ? "Waiting for sim data…"
    : !ofp
      ? ofpError ??
        (canLoadOfp
          ? "Loading OFP…"
          : "No SimBrief OFP linked. Set your SimBrief username in Stratos settings.")
      : null;

  const COLS = "52px 1fr 1fr 84px";
  const numCell: CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
  };

  return (
    <Card style={{ width: "100%", maxWidth: "none" }}>
      <CardHeader>
        <CardTitle>
          Loadsheet{ofp?.flightNumber ? ` — ${ofp.flightNumber}` : ""}
        </CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
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
        {statusMsg && (
          <p style={{ marginBottom: 12, fontSize: 13, opacity: 0.7 }}>{statusMsg}</p>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLS,
              alignItems: "center",
              gap: 12,
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              opacity: 0.5,
              paddingBottom: 4,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <span />
            <span style={{ textAlign: "right" }}>Actual</span>
            <span style={{ textAlign: "right" }}>Plan</span>
            <span style={{ textAlign: "right" }}>Δ</span>
          </div>

          {ls.cells.map((c) => (
            <div
              key={c.label}
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                alignItems: "center",
                gap: 12,
                paddingTop: 2,
              }}
            >
              <span style={{ fontWeight: 600 }}>{CELL_LABEL[c.label]}</span>
              <span style={numCell}>{fmtKg(c.istKg)}</span>
              <span style={{ ...numCell, opacity: 0.5 }}>{fmtKg(c.sollKg)}</span>
              <span style={{ textAlign: "right" }}>
                {c.deltaKg != null ? (
                  <Badge variant={SEVERITY_VARIANT[c.severity]}>
                    {c.overweight ? "⚠ " : ""}
                    {fmtDelta(c.deltaKg)}
                  </Badge>
                ) : (
                  <span style={{ opacity: 0.35 }}>—</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {hint && (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                flexShrink: 0,
                background: SEVERITY_DOT[worst],
              }}
            />
            <span>{hint}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
