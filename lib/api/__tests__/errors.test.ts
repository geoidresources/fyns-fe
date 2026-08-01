import { test } from "node:test";
import assert from "node:assert/strict";

import { stripErrNamespace } from "../errors.ts";

test("strips a Go package namespace from a wrapped sentinel error", () => {
  assert.equal(
    stripErrNamespace("measurements: invalid compute params"),
    "invalid compute params"
  );
  assert.equal(
    stripErrNamespace("measurements: compute not supported for this kind"),
    "compute not supported for this kind"
  );
});

test("leaves a CRS code alone — uppercase, so not a package name", () => {
  assert.equal(
    stripErrNamespace("EPSG:32756 is not a supported working CRS"),
    "EPSG:32756 is not a supported working CRS"
  );
});

test("leaves a URL alone — no space after the colon", () => {
  assert.equal(
    stripErrNamespace("https://storage.googleapis.com/x.tif is unreachable"),
    "https://storage.googleapis.com/x.tif is unreachable"
  );
});

test("strips only the first namespace, preserving nested detail", () => {
  assert.equal(
    stripErrNamespace("measurements: surfaceref: no co-registered dsm raster"),
    "surfaceref: no co-registered dsm raster"
  );
});

test("leaves a plain sentence alone", () => {
  const msg = "The upload timed out before any bytes were sent.";
  assert.equal(stripErrNamespace(msg), msg);
});

test("requires the namespace to sit immediately before the colon", () => {
  // A leading *phrase* is not a package name. "failed" is followed by a space,
  // not ": ", so nothing is stripped and the whole message survives — including
  // the namespace further in, which is not in the leading position.
  const msg = "failed after retry: measurements: invalid compute params";
  assert.equal(stripErrNamespace(msg), msg);
});

test("is a no-op on an empty message", () => {
  assert.equal(stripErrNamespace(""), "");
});
