import { test } from "node:test";
import assert from "node:assert/strict";

import type { ChangeSetEntry } from "../../api/assetSvc.ts";
import {
  buildChangeDetectPayload,
  changesUrlSet,
  currentChangeEntry,
  exteriorRing,
  freshChangeEntry,
  parseChangeFeatures,
  summarizeChangeEntry,
} from "../changeDetect.ts";

// Minimal entry fixture — the helpers only read processor_type + geojson_url +
// the metric fields.
const entry = (over: Partial<ChangeSetEntry> = {}): ChangeSetEntry => ({
  processor_type: "change-detect",
  geojson_url: "https://storage.googleapis.com/b/changes-wf1.geojson",
  cut_volume_m3: 120,
  fill_volume_m3: 80,
  net_m3: -40,
  region_count: 3,
  threshold_m: 0.25,
  ...over,
});

// ------------------------------------------------------------ parse features

test("parseChangeFeatures keeps cut/fill features and coerces metrics", () => {
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: { class: "cut", area_m2: 50, volume_m3: 20, mean_dz_m: -1.2, max_dz_m: -3 },
      },
      {
        geometry: { type: "Polygon", coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] },
        properties: { class: "fill", area_m2: 30, volume_m3: 10, mean_dz_m: 0.8, max_dz_m: 2 },
      },
    ],
  };
  const feats = parseChangeFeatures(fc);
  assert.equal(feats.length, 2);
  assert.equal(feats[0].properties.class, "cut");
  assert.equal(feats[0].properties.mean_dz_m, -1.2); // signed preserved
  assert.equal(feats[1].properties.class, "fill");
});

test("parseChangeFeatures drops features without a cut/fill class or geometry", () => {
  const fc = {
    features: [
      { geometry: { type: "Polygon", coordinates: [[[0, 0]]] }, properties: { class: "other" } },
      { properties: { class: "cut" } }, // no geometry
      { geometry: { type: "Polygon", coordinates: [[[0, 0]]] } }, // no properties
    ],
  };
  assert.equal(parseChangeFeatures(fc).length, 0);
});

test("parseChangeFeatures tolerates junk input", () => {
  assert.deepEqual(parseChangeFeatures(null), []);
  assert.deepEqual(parseChangeFeatures({}), []);
  assert.deepEqual(parseChangeFeatures({ features: "nope" }), []);
});

test("exteriorRing pulls ring 0 of a Polygon (and MultiPolygon defensively)", () => {
  assert.deepEqual(
    exteriorRing({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] }),
    [[0, 0], [1, 0], [1, 1]]
  );
  assert.deepEqual(
    exteriorRing({ type: "MultiPolygon", coordinates: [[[[5, 5], [6, 5]]]] }),
    [[5, 5], [6, 5]]
  );
  assert.deepEqual(exteriorRing({ type: "LineString", coordinates: [[0, 0]] }), []);
});

// ------------------------------------------------------------ summary

test("summarizeChangeEntry reads the server metrics verbatim", () => {
  assert.deepEqual(summarizeChangeEntry(entry()), {
    regionCount: 3,
    cutVolumeM3: 120,
    fillVolumeM3: 80,
    netM3: -40,
    thresholdM: 0.25,
  });
});

// ------------------------------------------------------------ poll url-diff

test("changesUrlSet snapshots only renderable change-detect URLs", () => {
  const set = changesUrlSet([
    entry({ geojson_url: "u1" }),
    entry({ geojson_url: undefined }), // no sidecar — skipped
    { ...entry(), processor_type: "other", geojson_url: "u2" }, // wrong processor
  ]);
  assert.deepEqual([...set], ["u1"]);
});

test("freshChangeEntry returns the entry whose URL is not in the snapshot", () => {
  const before = changesUrlSet([entry({ geojson_url: "old" })]);
  const fresh = freshChangeEntry(
    [entry({ geojson_url: "old" }), entry({ geojson_url: "new", region_count: 9 })],
    before
  );
  assert.equal(fresh?.geojson_url, "new");
  assert.equal(fresh?.region_count, 9);
});

test("freshChangeEntry returns null while only the pre-dispatch set is present", () => {
  const before = changesUrlSet([entry({ geojson_url: "old" })]);
  assert.equal(freshChangeEntry([entry({ geojson_url: "old" })], before), null);
  assert.equal(freshChangeEntry(null, before), null);
});

test("currentChangeEntry picks the last renderable entry (re-run wins on reload)", () => {
  assert.equal(currentChangeEntry(null), null);
  const chosen = currentChangeEntry([
    entry({ geojson_url: "first" }),
    entry({ geojson_url: "second" }),
  ]);
  assert.equal(chosen?.geojson_url, "second");
});

// ------------------------------------------------------------ dispatch payload

test("buildChangeDetectPayload matches the frozen from/to ArtifactRef shape", () => {
  const payload = buildChangeDetectPayload({
    fromUrl: "https://storage.googleapis.com/b/A-dsm.tif",
    fromCrs: "EPSG:4326",
    toUrl: "https://storage.googleapis.com/b/B-dsm.tif",
    toCrs: "EPSG:4326",
    thresholdM: 0.25,
    minAreaM2: 10,
  });
  assert.deepEqual(payload, {
    from: { url: "https://storage.googleapis.com/b/A-dsm.tif", kind: "terrain", crs: "EPSG:4326" },
    to: { url: "https://storage.googleapis.com/b/B-dsm.tif", kind: "terrain", crs: "EPSG:4326" },
    threshold_m: 0.25,
    min_area_m2: 10,
  });
});
