import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildContourRequest,
  contourTileTemplate,
  suggestContourInterval,
} from "../contours.ts";

// ---------------------------------------------------- suggestContourInterval

test("suggestContourInterval targets ~20 bands and snaps to a nice step", () => {
  // range/20 lands exactly on a nice value → used verbatim.
  assert.equal(suggestContourInterval(0, 100), 5); // 100/20 = 5  → 20 bands
  assert.equal(suggestContourInterval(0, 200), 10); // 200/20 = 10 → 20 bands
  assert.equal(suggestContourInterval(0, 20), 1); // 20/20  = 1  → 20 bands
  assert.equal(suggestContourInterval(0, 1000), 50); // 1000/20 = 50 → 20 bands
  assert.equal(suggestContourInterval(0, 2000), 100); // 2000/20 = 100 → 20 bands
});

test("suggestContourInterval snaps an awkward raw step to the nearest 1/2/5", () => {
  // Absolute elevations, 50 m of relief: raw = 2.5 → nearest nice is 2.
  assert.equal(suggestContourInterval(1200, 1250), 2);
  // raw = 3.5 → nearest nice is 5.
  assert.equal(suggestContourInterval(0, 70), 5);
});

test("suggestContourInterval handles sub-metre steps via the decade below 1", () => {
  // 7 m of relief → raw 0.35 → 0.5 m contours.
  assert.ok(Math.abs((suggestContourInterval(0, 7) ?? NaN) - 0.5) < 1e-9);
});

test("suggestContourInterval returns null for a non-positive or non-finite range", () => {
  assert.equal(suggestContourInterval(0, 0), null);
  assert.equal(suggestContourInterval(10, 10), null);
  assert.equal(suggestContourInterval(100, 50), null); // max < min
  assert.equal(suggestContourInterval(Number.NaN, 100), null);
  assert.equal(suggestContourInterval(0, Number.POSITIVE_INFINITY), null);
});

// -------------------------------------------------------- buildContourRequest

test("buildContourRequest emits the deployed contour-generate v1 shape", () => {
  const req = buildContourRequest({
    sourceUrl: "gs://bucket/original/dsm.tif",
    crs: "EPSG:32645",
    intervalM: 5,
  });
  assert.deepEqual(req, {
    processor_type: "contour-generate",
    version: "v1",
    payload: {
      source: { url: "gs://bucket/original/dsm.tif", kind: "terrain", crs: "EPSG:32645" },
      interval_m: 5,
    },
    inputs: [{ url: "gs://bucket/original/dsm.tif", kind: "terrain", crs: "EPSG:32645" }],
  });
});

test("buildContourRequest omits crs when absent, keeping the wire shape clean", () => {
  const req = buildContourRequest({ sourceUrl: "gs://bucket/dtm.tif", intervalM: 2 });
  assert.deepEqual(req.payload, {
    source: { url: "gs://bucket/dtm.tif", kind: "terrain" },
    interval_m: 2,
  });
  assert.deepEqual(req.inputs, [{ url: "gs://bucket/dtm.tif", kind: "terrain" }]);
  assert.ok(!("crs" in (req.inputs![0] as object)));
});

test("buildContourRequest source and the input ref describe the same artifact", () => {
  const req = buildContourRequest({ sourceUrl: "gs://b/dsm.tif", crs: "EPSG:4326", intervalM: 1 });
  const payloadSource = (req.payload as { source: unknown }).source;
  assert.deepEqual(payloadSource, req.inputs![0]);
});

// -------------------------------------------------------- contourTileTemplate

test("contourTileTemplate returns the template + zoom bounds when tiles are present", () => {
  const info = contourTileTemplate({
    output_urls: {
      template: "https://storage.googleapis.com/b/contours/5m/{z}/{x}/{y}.png",
      directory: "https://storage.googleapis.com/b/contours/5m",
    },
    tile_min_zoom: 12,
    tile_max_zoom: 20,
    tile_crs: "EPSG:3857",
  });
  assert.deepEqual(info, {
    template: "https://storage.googleapis.com/b/contours/5m/{z}/{x}/{y}.png",
    minZoom: 12,
    maxZoom: 20,
  });
});

test("contourTileTemplate accepts a proxied (/gcs) template verbatim", () => {
  // proxyGcsUrls rewrites the template at manifest load; the {z}/{x}/{y} marker
  // survives, so the tiles path still engages and the proxied URL is used as-is.
  const info = contourTileTemplate({
    output_urls: { template: "/gcs/b/contours/1m/{z}/{x}/{y}.png" },
  });
  assert.equal(info?.template, "/gcs/b/contours/1m/{z}/{x}/{y}.png");
  assert.equal(info?.minZoom, undefined);
  assert.equal(info?.maxZoom, undefined);
});

test("contourTileTemplate returns null when no usable tiles are present (GeoJSON fallback)", () => {
  assert.equal(contourTileTemplate(undefined), null);
  assert.equal(contourTileTemplate({}), null);
  assert.equal(contourTileTemplate({ output_urls: {} }), null);
  // A directory-only bundle with no {z}/{x}/{y} template is not usable as XYZ.
  assert.equal(
    contourTileTemplate({ output_urls: { directory: "https://storage.googleapis.com/b/c" } }),
    null
  );
  // interval_m present but the tiles bundle absent → still GeoJSON.
  assert.equal(contourTileTemplate({ interval_m: 5 }), null);
});

test("contourTileTemplate rejects a non-3857 grid so the caller keeps GeoJSON", () => {
  assert.equal(
    contourTileTemplate({
      output_urls: { template: "https://x/{z}/{x}/{y}.png" },
      tile_crs: "EPSG:4326",
    }),
    null
  );
});

test("contourTileTemplate ignores non-positive / non-finite zoom bounds", () => {
  const info = contourTileTemplate({
    output_urls: { template: "https://x/{z}/{x}/{y}.png" },
    tile_min_zoom: 0,
    tile_max_zoom: Number.NaN,
  });
  assert.equal(info?.template, "https://x/{z}/{x}/{y}.png");
  assert.equal(info?.minZoom, undefined);
  assert.equal(info?.maxZoom, undefined);
});
