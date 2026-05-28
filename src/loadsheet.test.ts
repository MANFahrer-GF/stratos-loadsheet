import { describe, it, expect } from "vitest";
import { parseSimbriefOfp, extractTag } from "./simbriefOfp";
import { buildLoadsheet, ofpLooksOutdated, lbsToKg } from "./loadsheet";

const SAMPLE_KG = `<?xml version="1.0"?>
<OFP>
  <params><time_generated>1716800000</time_generated><request_id>ABC123</request_id></params>
  <atc><callsign>DLH123</callsign></atc>
  <origin><icao_code>EDDF</icao_code></origin>
  <destination><icao_code>LEPA</icao_code></destination>
  <alternate><icao_code>LEIB</icao_code><iata_code>IBZ</iata_code></alternate>
  <fuel><plan_ramp>13884</plan_ramp><enroute_burn>9000</enroute_burn><reserve>2200</reserve></fuel>
  <weights>
    <est_zfw>60759</est_zfw><est_tow>74634</est_tow><est_ldw>65000</est_ldw>
    <max_zfw>62500</max_zfw><max_tow>79000</max_tow><max_ldw>67400</max_ldw>
    <pax_count>174</pax_count><cargo>1500</cargo>
  </weights>
  <general><units><wt_unit>kgs</wt_unit></units></general>
  <route>DENUT5L DENUT M624 SUSAN</route>
</OFP>`;

const SAMPLE_LB = SAMPLE_KG.replace("<wt_unit>kgs</wt_unit>", "<wt_unit>lbs</wt_unit>");

describe("extractTag", () => {
  it("returns inner text and tolerates attributes", () => {
    expect(extractTag("<a>x</a>", "a")).toBe("x");
    expect(extractTag('<a id="1">y</a>', "a")).toBe("y");
    expect(extractTag("<a>x</a>", "b")).toBeNull();
  });
});

describe("parseSimbriefOfp (kg)", () => {
  const ofp = parseSimbriefOfp(SAMPLE_KG)!;
  it("maps weights + fuel verbatim in kg", () => {
    expect(ofp.blockFuelKg).toBe(13884);
    expect(ofp.zfwKg).toBe(60759);
    expect(ofp.towKg).toBe(74634);
    expect(ofp.maxTowKg).toBe(79000);
    expect(ofp.burnKg).toBe(9000);
  });
  it("extracts identity + pax/cargo", () => {
    expect(ofp.flightNumber).toBe("DLH123");
    expect(ofp.originIcao).toBe("EDDF");
    expect(ofp.destinationIcao).toBe("LEPA");
    expect(ofp.alternate).toBe("LEIB");
    expect(ofp.requestId).toBe("ABC123");
    expect(ofp.paxCount).toBe(174);
    expect(ofp.cargoKg).toBe(1500);
  });
});

describe("parseSimbriefOfp (lbs → kg normalisation)", () => {
  it("converts lbs weights to kg", () => {
    const ofp = parseSimbriefOfp(SAMPLE_LB)!;
    expect(ofp.zfwKg).toBeCloseTo(60759 * 0.45359237, 1);
    expect(ofp.blockFuelKg).toBeCloseTo(13884 * 0.45359237, 1);
  });
  it("returns null for a weightless/broken OFP", () => {
    expect(parseSimbriefOfp("<OFP><fuel></fuel></OFP>")).toBeNull();
  });
});

describe("buildLoadsheet", () => {
  const ofp = parseSimbriefOfp(SAMPLE_KG);

  it("matches the example loadsheet (Block 13885 vs Plan 13884, Δ +1)", () => {
    const ls = buildLoadsheet({ blockFuelKg: 13885, zfwKg: 60759, towKg: 74644 }, ofp);
    const block = ls.cells.find((c) => c.label === "block")!;
    expect(block.deltaKg).toBe(1);
    expect(block.severity).toBe("ok");
    expect(ls.hint.kind).toBe("ready");
    expect(ls.ofpLooksOutdated).toBe(false);
  });

  it("flags overweight when IST TOW exceeds max", () => {
    const ls = buildLoadsheet({ blockFuelKg: 13884, zfwKg: 60759, towKg: 80000 }, ofp);
    const tow = ls.cells.find((c) => c.label === "tow")!;
    expect(tow.overweight).toBe(true);
    expect(tow.severity).toBe("alert");
  });

  it("hints fueling when block fuel is far short", () => {
    const ls = buildLoadsheet({ blockFuelKg: 12000, zfwKg: 60759, towKg: 72000 }, ofp);
    expect(ls.hint.kind).toBe("fueling");
    expect(ls.hint.amountKg).toBe(1884);
  });
});

describe("ofpLooksOutdated", () => {
  it("true when fuel delta large but ZFW matches (stale OFP)", () => {
    expect(ofpLooksOutdated(900, 50, 13884)).toBe(true);
  });
  it("false when ZFW also moved (real reload, not stale plan)", () => {
    expect(ofpLooksOutdated(900, 800, 13884)).toBe(false);
  });
  it("false for small fuel delta", () => {
    expect(ofpLooksOutdated(100, 0, 13884)).toBe(false);
  });
});

describe("lbsToKg", () => {
  it("converts Stratos lbs actuals to kg", () => {
    expect(lbsToKg(30610)).toBeCloseTo(13884, 0);
  });
});
