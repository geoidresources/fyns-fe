import { test } from "node:test";
import assert from "node:assert/strict";
import { Cartographic, Cartesian3, Math as CesiumMath } from "cesium";

import { captureCameraPose, applyCameraPose } from "../camera.ts";
import type { CameraPose } from "../state/store.ts";

type ViewerArg = Parameters<typeof captureCameraPose>[0];

interface SetViewArgs {
  destination: Cartesian3;
  orientation: { heading: number; pitch: number; roll: number };
}

function captureViewer(
  carto: Cartographic,
  heading: number,
  pitch: number,
  roll: number
): ViewerArg {
  return {
    camera: { positionCartographic: carto, heading, pitch, roll },
  } as unknown as ViewerArg;
}

test("captureCameraPose converts radians→degrees without rounding", () => {
  // A high-precision longitude: 6-dp rounding would shift it by ~3e-7, so a
  // sub-1e-8 match proves capture keeps full float fidelity (§5.3 "no rounding").
  const lon = 151.2014327;
  const carto = Cartographic.fromDegrees(lon, -32.800917, 412.3);
  const pose = captureCameraPose(
    captureViewer(carto, CesiumMath.toRadians(45.0), CesiumMath.toRadians(-32.5), 0)
  );
  assert.ok(Math.abs(pose.lon - lon) < 1e-8, `lon=${pose.lon}`);
  assert.ok(Math.abs(pose.lat - -32.800917) < 1e-8, `lat=${pose.lat}`);
  assert.ok(Math.abs(pose.h - 412.3) < 1e-6, `h=${pose.h}`);
  assert.ok(Math.abs(pose.heading - 45.0) < 1e-9, `heading=${pose.heading}`);
  assert.ok(Math.abs(pose.pitch - -32.5) < 1e-9, `pitch=${pose.pitch}`);
});

test("camera pose round-trips through applyCameraPose→captureCameraPose", () => {
  const original: CameraPose = {
    lon: 151.2014327,
    lat: -32.800917,
    h: 412.3,
    heading: 45.0,
    pitch: -32.5,
    roll: 0,
  };

  let recorded: SetViewArgs | null = null;
  const applyTarget = {
    camera: {
      setView: (args: SetViewArgs) => {
        recorded = args;
      },
      flyTo: () => {
        throw new Error("setView expected, not flyTo, without animate");
      },
    },
  } as unknown as ViewerArg;

  applyCameraPose(applyTarget, original);
  assert.ok(recorded, "setView was called");
  const args = recorded as SetViewArgs;

  const carto = Cartographic.fromCartesian(args.destination);
  const round = captureCameraPose(
    captureViewer(
      carto,
      args.orientation.heading,
      args.orientation.pitch,
      args.orientation.roll
    )
  );

  assert.ok(Math.abs(round.lon - original.lon) < 1e-6, `lon=${round.lon}`);
  assert.ok(Math.abs(round.lat - original.lat) < 1e-6, `lat=${round.lat}`);
  assert.ok(Math.abs(round.h - original.h) < 1e-3, `h=${round.h}`);
  assert.ok(Math.abs(round.heading - original.heading) < 1e-6, `heading=${round.heading}`);
  assert.ok(Math.abs(round.pitch - original.pitch) < 1e-6, `pitch=${round.pitch}`);
  assert.ok(Math.abs(round.roll - original.roll) < 1e-6, `roll=${round.roll}`);
});

test("applyCameraPose animate runs a 1.2s flyTo", () => {
  let flew: { duration?: number } | null = null;
  const target = {
    camera: {
      flyTo: (args: { duration: number }) => {
        flew = args;
      },
      setView: () => {
        throw new Error("flyTo expected with animate");
      },
    },
  } as unknown as ViewerArg;

  applyCameraPose(
    target,
    { lon: 151, lat: -32, h: 400, heading: 0, pitch: -45, roll: 0 },
    { animate: true }
  );
  assert.ok(flew, "flyTo was called");
  assert.equal((flew as { duration: number }).duration, 1.2);
});
