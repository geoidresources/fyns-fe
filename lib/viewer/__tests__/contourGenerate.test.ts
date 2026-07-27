import { test } from "node:test";
import assert from "node:assert/strict";

import type { VectorLayer } from "../../api/assetSvc.ts";
import {
  buildContourGeneratePayload,
  contoursUrlSet,
  freshContourVector,
} from "../contourGenerate.ts";

// Minimal vector fixture — the helpers only read role + geojson_url + interval_m
// + feature_count.
const vector = (over: Partial<VectorLayer> = {}): VectorLayer => ({
  role: "contours_5m",
  geojson_url: "https://storage.googleapis.com/b/contours-wf1.geojson",
  feature_count: 42,
  interval_m: 5,
  ...over,
});

// ------------------------------------------------------------ dispatch payload

test("buildContourGeneratePayload uses intervals_m (array) + geojson format", () => {
  const payload = buildContourGeneratePayload({
    url: "https://storage.googleapis.com/b/dsm.tif",
    crs: "EPSG:32756",
    intervalM: 5,
  });
  assert.deepEqual(payload, {
    source: { url: "https://storage.googleapis.com/b/dsm.tif", kind: "terrain", crs: "EPSG:32756" },
    intervals_m: [5], // NOT a scalar interval_m — distinct role per interval
    format: "geojson",
  });
});

test("buildContourGeneratePayload keeps crs undefined when absent", () => {
  const payload = buildContourGeneratePayload({ url: "u", intervalM: 2 });
  assert.equal(payload.source.crs, undefined);
  assert.equal(payload.source.kind, "terrain");
  assert.deepEqual(payload.intervals_m, [2]);
});

// ------------------------------------------------------------ poll url-diff

test("contoursUrlSet snapshots only contour vector URLs (bare + suffixed roles)", () => {
  const set = contoursUrlSet([
    vector({ geojson_url: "u1", role: "contours_5m" }),
    vector({ geojson_url: "u2", role: "contours" }), // bare role counts too
    vector({ geojson_url: "img", role: "image_positions" }), // not a contour — skipped
    vector({ geojson_url: undefined }), // no sidecar — skipped
  ]);
  assert.deepEqual([...set].sort(), ["u1", "u2"]);
});

test("freshContourVector returns the vector whose URL is not in the snapshot", () => {
  const before = contoursUrlSet([
    vector({ geojson_url: "old", interval_m: 10, role: "contours_10m" }),
  ]);
  const fresh = freshContourVector(
    [
      vector({ geojson_url: "old", interval_m: 10, role: "contours_10m" }),
      vector({ geojson_url: "new", interval_m: 5, role: "contours_5m", feature_count: 88 }),
    ],
    before
  );
  assert.equal(fresh?.url, "new");
  assert.equal(fresh?.intervalM, 5);
  assert.equal(fresh?.role, "contours_5m");
  assert.equal(fresh?.featureCount, 88);
});

test("freshContourVector returns null while only the pre-dispatch set is present", () => {
  const before = contoursUrlSet([vector({ geojson_url: "old" })]);
  assert.equal(freshContourVector([vector({ geojson_url: "old" })], before), null);
  assert.equal(freshContourVector(null, before), null);
});
