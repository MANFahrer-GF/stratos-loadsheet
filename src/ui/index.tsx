import { useEffect, useRef, useState, type CSSProperties } from "react";
// Import from the bare specifier — the Stratos shell provides this module at
// runtime (window.__stratos_modules__), so hooks share the shell's React
// context + query client. Subpath imports would bundle a second SDK copy.
import {
  useTrackingSession,
  useSimData,
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

// Display weight unit — the user's preference from Stratos settings
// (config.weightUnit). All internal math stays in kg; we only convert for
// display so deltas/thresholds remain consistent regardless of unit.
type WeightUnit = "kg" | "lbs";
const KG_PER_LB = 0.453_592_37;
const toUnit = (kg: number, unit: WeightUnit) =>
  unit === "lbs" ? kg / KG_PER_LB : kg;

const fmtWeight = (kg: number | null, unit: WeightUnit) =>
  kg == null
    ? "—"
    : `${Math.round(toUnit(kg, unit)).toLocaleString("en-US")} ${unit}`;

const fmtDelta = (kg: number, unit: WeightUnit) => {
  const r = Math.round(toUnit(kg, unit));
  return `${r >= 0 ? "+" : ""}${r.toLocaleString("en-US")}`;
};

const fmtAmount = (kg: number, unit: WeightUnit) =>
  `${Math.round(toUnit(kg, unit)).toLocaleString("en-US")} ${unit}`;

function hintText(ls: Loadsheet, unit: WeightUnit): string | null {
  const amt = ls.hint.amountKg != null ? fmtAmount(ls.hint.amountKg, unit) : "";
  switch (ls.hint.kind) {
    case "ready":
      return "Loadsheet matches — ready to go.";
    case "fueling":
      return `Add ${amt} more fuel.`;
    case "boarding":
      return `${amt} of payload still to load.`;
    case "overfueled":
      return `${amt} more fuel than planned.`;
    default:
      return ls.ofpLooksOutdated
        ? "OFP looks outdated — re-plan and restart if needed."
        : null;
  }
}

/** Build the one-line summary written into the PIREP at block-off. */
function pirepSummary(ls: Loadsheet, unit: WeightUnit): string {
  const part = (c: LoadsheetCell) => {
    if (c.istKg == null) return null;
    const v = fmtWeight(c.istKg, unit);
    const plan =
      c.sollKg != null && c.deltaKg != null
        ? ` (Plan ${fmtWeight(c.sollKg, unit)}, Δ ${fmtDelta(c.deltaKg, unit)})`
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
  const { addComment } = useFlightEvents();
  // SimBrief username AND weight-unit preference both come from the user's
  // GLOBAL Stratos settings via the local app config endpoint — no separate
  // plugin settings, nothing entered twice.
  const [username, setUsername] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("kg");
  useEffect(() => {
    let cancelled = false;
    fetch(`${STRATOS_APP_BASE}/api/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return;
        if (typeof j.data.simbriefUsername === "string") setUsername(j.data.simbriefUsername);
        if (j.data.weightUnit === "lbs" || j.data.weightUnit === "kg") setUnit(j.data.weightUnit);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    addComment(pirepSummary(ls, unit));
    sentForFlight.current = flightId;
  }, [phase, flightId, blockFuelKg, zfwKg, ls, unit, addComment]);

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
  const hint = hintText(ls, unit);
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

  // Fixed, tightly-grouped columns (packed left, not stretched across the
  // full width) so Label · Actual · Plan · Δ read as one compact block.
  // All tracks are fixed — an `auto`/`fr` last track would expand and push
  // the Δ badge to the far right.
  const COLS = "72px 150px 150px 96px";
  const GRID_GAP = 20;
  const numBase: CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
  };
  const actualCell: CSSProperties = { ...numBase, fontSize: 20, fontWeight: 600 };
  const planCell: CSSProperties = { ...numBase, fontSize: 14, opacity: 0.5 };

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
              gap: GRID_GAP,
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              opacity: 0.5,
              paddingBottom: 6,
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
                gap: GRID_GAP,
                paddingTop: 6,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 15 }}>{CELL_LABEL[c.label]}</span>
              <span style={actualCell}>{fmtWeight(c.istKg, unit)}</span>
              <span style={planCell}>{fmtWeight(c.sollKg, unit)}</span>
              <span style={{ textAlign: "right" }}>
                {c.deltaKg != null ? (
                  <Badge
                    variant={SEVERITY_VARIANT[c.severity]}
                    style={{ fontSize: 14, padding: "4px 11px" }}
                  >
                    {c.overweight ? "⚠ " : ""}
                    {fmtDelta(c.deltaKg, unit)}
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
