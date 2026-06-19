import React from "react";

/**
 * Hero isometric city skyline, ported faithfully from the TerraMine design
 * export (`_buildCity`). Rendered as a background SVG behind the hero copy.
 */
function buildCity(): React.ReactElement {
  const bw = 45;
  const ds = 18;
  const dr = 9;
  const bX = 250;
  const bY = 440;
  const xS = 100;
  const yS = 28;
  const dS = 25;

  const HS = [
    [40, 55, 48, 52, 38],
    [85, 120, 100, 105, 75],
    [110, 210, 270, 190, 130],
    [75, 105, 130, 95, 65],
  ];
  const OS = [
    [0.08, 0.1, 0.09, 0.09, 0.08],
    [0.16, 0.22, 0.19, 0.18, 0.14],
    [0.22, 0.4, 0.45, 0.38, 0.23],
    [0.12, 0.17, 0.19, 0.14, 0.1],
  ];

  const els: React.ReactElement[] = [];
  const E = React.createElement;

  for (let r = 0; r <= 3; r++) {
    const sy = bY - r * yS + 5;
    els.push(E("line", { key: "sh" + r, x1: bX - 40, y1: sy, x2: bX + 4 * xS + 3 * dS + bw + 40, y2: sy, stroke: "rgba(194,112,62,0.04)", strokeWidth: 0.5 }));
  }
  for (let c = 0; c <= 5; c++) {
    els.push(E("line", { key: "sv" + c, x1: bX + c * xS - 10, y1: bY + 5, x2: bX + c * xS + 3 * dS - 10, y2: bY - 3 * yS + 5, stroke: "rgba(194,112,62,0.03)", strokeWidth: 0.5 }));
  }
  for (let ry = 3; ry >= 0; ry--) {
    for (let cx = 0; cx < 5; cx++) {
      const h = HS[3 - ry][cx];
      const op = OS[3 - ry][cx];
      const sx = bX + cx * xS + ry * dS;
      const sby = bY - ry * yS;
      const ty = sby - h;
      const k = ry + "_" + cx;
      const gl = op >= 0.35;
      els.push(E("rect", { key: "f" + k, x: sx, y: ty, width: bw, height: h, fill: "rgba(194,112,62," + (op * 0.06).toFixed(3) + ")", stroke: "rgba(194,112,62," + op.toFixed(2) + ")", strokeWidth: gl ? 1 : 0.7 }));
      els.push(E("polygon", { key: "t" + k, points: sx + "," + ty + " " + (sx + bw) + "," + ty + " " + (sx + bw + ds) + "," + (ty - dr) + " " + (sx + ds) + "," + (ty - dr), fill: "rgba(194,112,62," + (op * 0.03).toFixed(3) + ")", stroke: "rgba(194,112,62," + (op * 0.5).toFixed(2) + ")", strokeWidth: 0.5 }));
      els.push(E("polygon", { key: "s" + k, points: (sx + bw) + "," + ty + " " + (sx + bw + ds) + "," + (ty - dr) + " " + (sx + bw + ds) + "," + (sby - dr) + " " + (sx + bw) + "," + sby, fill: "rgba(194,112,62," + (op * 0.02).toFixed(3) + ")", stroke: "rgba(194,112,62," + (op * 0.35).toFixed(2) + ")", strokeWidth: 0.5 }));
      const fc = Math.max(Math.floor(h / 28), 2);
      for (let f = 1; f < fc; f++) {
        const ly = ty + f * (h / fc);
        els.push(E("line", { key: "l" + k + "_" + f, x1: sx + 0.5, y1: ly, x2: sx + bw - 0.5, y2: ly, stroke: "rgba(194,112,62," + (op * 0.2).toFixed(2) + ")", strokeWidth: 0.5 }));
      }
    }
  }

  return E(
    "svg",
    {
      viewBox: "0 0 1100 500",
      fill: "none",
      preserveAspectRatio: "xMidYMax meet",
      style: { position: "absolute", bottom: "2%", left: 0, width: "100%", height: "78%" },
    },
    els
  );
}

const PARTICLES = [
  { left: "15%", top: "25%", size: 2, bg: 0.2, dur: 9, delay: 0 },
  { left: "25%", top: "45%", size: 1, bg: 0.15, dur: 12, delay: 2 },
  { left: "38%", top: "30%", size: 2, bg: 0.22, dur: 8, delay: 1 },
  { left: "48%", top: "52%", size: 1, bg: 0.18, dur: 14, delay: 3 },
  { left: "58%", top: "35%", size: 2, bg: 0.2, dur: 10, delay: 0.5 },
  { left: "68%", top: "42%", size: 1, bg: 0.12, dur: 11, delay: 4 },
  { left: "75%", top: "28%", size: 2, bg: 0.2, dur: 13, delay: 1.5 },
  { left: "82%", top: "48%", size: 1, bg: 0.15, dur: 9, delay: 5 },
  { left: "20%", top: "55%", size: 2, bg: 0.1, dur: 15, delay: 2.5 },
  { left: "42%", top: "20%", size: 1, bg: 0.2, dur: 10, delay: 3.5 },
  { left: "88%", top: "38%", size: 1, bg: 0.18, dur: 12, delay: 6 },
];

export function IsometricCity() {
  return (
    <>
      {/* Perspective grid floor */}
      <div
        aria-hidden
        className="absolute bottom-0"
        style={{
          left: "-50%",
          width: "200%",
          height: "55%",
          backgroundImage:
            "linear-gradient(rgba(194,112,62,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(194,112,62,0.04) 1px,transparent 1px)",
          backgroundSize: "60px 60px",
          transform: "perspective(600px) rotateX(55deg)",
          transformOrigin: "50% 100%",
          opacity: 0.5,
        }}
      />

      {/* Isometric city */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {buildCity()}
      </div>

      {/* Drifting particles */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              background: `rgba(194,112,62,${p.bg})`,
              animation: `drift ${p.dur}s linear ${p.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Warm glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{
          width: 600,
          height: 600,
          transform: "translate(-50%,-50%)",
          background: "radial-gradient(circle,rgba(194,112,62,0.06) 0%,transparent 70%)",
        }}
      />
    </>
  );
}
