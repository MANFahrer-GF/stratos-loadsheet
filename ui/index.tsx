import { useEffect, useState } from "react";
// Import from the bare specifier — the Stratos shell provides this module at
// runtime (window.__stratos_modules__), so hooks share the shell's React
// context + query client. Subpath imports would bundle a second SDK copy.
import {
  useTrackingSession,
  useShellConfig,
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
} from "../src/loadsheet";
import {
  fetchSimbriefOfpById,
  fetchSimbriefOfpByUsername,
  type SimBriefOfp,
} from "../src/simbriefOfp";

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

const kg = (v: number | null) =>
  v == null ? "—" : `${Math.round(v).toLocaleString("de-DE")} kg`;

function hintText(ls: Loadsheet): string | null {
  const h = ls.hint;
  switch (h.kind) {
    case "ready":
      return "Loadsheet passt — startklar.";
    case "fueling":
      return `Noch ${h.amountKg?.toLocaleString("de-DE")} kg nachtanken.`;
    case "boarding":
      return `Noch ${h.amountKg?.toLocaleString("de-DE")} kg Zuladung fehlt.`;
    case "overfueled":
      return `${h.amountKg?.toLocaleString("de-DE")} kg mehr getankt als geplant.`;
    default:
      return ls.ofpLooksOutdated
        ? "OFP wirkt veraltet — neu planen und ggf. erneut starten."
        : null;
  }
}

/** Root component for the Stratos Loadsheet plugin. */
export default function LoadsheetPlugin() {
  const { currentFlight } = useTrackingSession();
  const config = useShellConfig();
  const username = config.get<string>("simbriefUsername", "");

  const [ofp, setOfp] = useState<SimBriefOfp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = currentFlight?.flightPlan;
  const ofpId = plan?.source === "simbrief" ? plan.sourceId : undefined;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    async function load() {
      try {
        const result = ofpId
          ? await fetchSimbriefOfpById(ofpId)
          : username
            ? await fetchSimbriefOfpByUsername(username)
            : null;
        if (!cancelled) setOfp(result);
      } catch {
        if (!cancelled) setError("SimBrief-OFP konnte nicht geladen werden.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [ofpId, username]);

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

  // Stratos captures block-off actuals in lbs → normalise to kg.
  const blockFuelKg = currentFlight.startingFuel > 0 ? lbsToKg(currentFlight.startingFuel) : null;
  const zfwKg = currentFlight.startingZfw > 0 ? lbsToKg(currentFlight.startingZfw) : null;
  const towKg =
    blockFuelKg != null && zfwKg != null ? blockFuelKg + zfwKg : null;

  const ls = buildLoadsheet({ blockFuelKg, zfwKg, towKg }, ofp);
  const hint = hintText(ls);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Stratos Loadsheet{ofp?.flightNumber ? ` — ${ofp.flightNumber}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!ofp && (
          <p>
            {error ??
              (ofpId || username
                ? "OFP wird geladen…"
                : "Kein SimBrief-OFP verknüpft. Trage deinen SimBrief-Usernamen in den Plugin-Einstellungen ein.")}
          </p>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          {ls.cells.map((c) => (
            <div
              key={c.label}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <span style={{ width: 56, fontWeight: 600 }}>{CELL_LABEL[c.label]}</span>
              <span style={{ fontFamily: "monospace", minWidth: 110 }}>{kg(c.istKg)}</span>
              <span style={{ opacity: 0.6, fontFamily: "monospace" }}>
                Plan {kg(c.sollKg)}
              </span>
              {c.deltaKg != null && (
                <Badge variant={SEVERITY_VARIANT[c.severity]}>
                  {c.overweight ? "⚠ " : ""}
                  {c.deltaKg >= 0 ? "+" : ""}
                  {Math.round(c.deltaKg).toLocaleString("de-DE")} kg
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
