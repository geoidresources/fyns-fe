import React from "react";

/**
 * Isometric "Digital Twyn" building, ported faithfully from the TerraMine design
 * export. Deterministic (seed=42) so window lighting is stable. Floor 7 is the
 * highlighted/isolated level.
 */
function buildBuilding(): React.ReactElement {
  const fx = 125;
  const fy = 40;
  const fw = 140;
  const fh = 360;
  const dx = 40;
  const dy = -20;
  const floors = 12;
  const cols = 5;
  const flH = fh / floors;
  const colW = fw / cols;

  let seed = 42;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const els: React.ReactElement[] = [];
  const E = React.createElement;

  // Glow
  els.push(E("ellipse", { key: "g1", cx: 200, cy: 240, rx: 110, ry: 200, fill: "rgba(194,112,62,0.035)" }));
  els.push(E("ellipse", { key: "g2", cx: 200, cy: 450, rx: 150, ry: 35, fill: "rgba(194,112,62,0.05)" }));

  // Grid floor
  [458, 470, 482].forEach((y, i) =>
    els.push(
      E("line", {
        key: "gh" + i,
        x1: 10 + i * 20,
        y1: y,
        x2: 410 - i * 10,
        y2: y,
        stroke: "rgba(194,112,62," + (0.07 - i * 0.02).toFixed(3) + ")",
        strokeWidth: 0.5,
      })
    )
  );
  [80, 130, 200, 270, 330].forEach((x, i) =>
    els.push(
      E("line", {
        key: "gv" + i,
        x1: x,
        y1: 448,
        x2: x + (x - 200) * 0.35,
        y2: 498,
        stroke: "rgba(194,112,62,0.04)",
        strokeWidth: 0.5,
      })
    )
  );
  els.push(E("ellipse", { key: "sr1", cx: 200, cy: 458, rx: 165, ry: 30, stroke: "rgba(194,112,62,0.07)", strokeWidth: 0.5, strokeDasharray: "4 6", fill: "none" }));
  els.push(E("ellipse", { key: "sr2", cx: 200, cy: 458, rx: 115, ry: 22, stroke: "rgba(194,112,62,0.05)", strokeWidth: 0.5, strokeDasharray: "3 8", fill: "none" }));

  // Podium faces
  els.push(E("polygon", { key: "pf", points: "90,400 300,400 300,448 90,448", fill: "rgba(194,112,62,0.035)", stroke: "rgba(194,112,62,0.25)", strokeWidth: 0.8 }));
  els.push(E("polygon", { key: "pt", points: "90,400 300,400 340,380 130,380", fill: "rgba(194,112,62,0.03)", stroke: "rgba(194,112,62,0.18)", strokeWidth: 0.5 }));
  els.push(E("polygon", { key: "ps", points: "300,400 340,380 340,428 300,448", fill: "rgba(194,112,62,0.02)", stroke: "rgba(194,112,62,0.15)", strokeWidth: 0.5 }));

  // Podium windows
  for (let c = 0; c < 4; c++) {
    els.push(E("rect", { key: "pwa" + c, x: 90 + c * 52 + 5, y: 404, width: 42, height: 17, fill: "rgba(194,112,62," + (0.04 + rng() * 0.07).toFixed(3) + ")", rx: 1 }));
    els.push(E("rect", { key: "pwb" + c, x: 90 + c * 52 + 5, y: 426, width: 42, height: 17, fill: "rgba(194,112,62," + (0.03 + rng() * 0.06).toFixed(3) + ")", rx: 1 }));
  }

  // Tower front face
  els.push(E("rect", { key: "ff", x: fx, y: fy, width: fw, height: fh, fill: "rgba(194,112,62,0.045)", stroke: "rgba(194,112,62,0.4)", strokeWidth: 1 }));
  // Tower top face
  els.push(E("polygon", { key: "tf", points: fx + "," + fy + " " + (fx + fw) + "," + fy + " " + (fx + fw + dx) + "," + (fy + dy) + " " + (fx + dx) + "," + (fy + dy), fill: "rgba(194,112,62,0.05)", stroke: "rgba(194,112,62,0.35)", strokeWidth: 0.8 }));
  // Tower right side
  els.push(E("polygon", { key: "sf", points: (fx + fw) + "," + fy + " " + (fx + fw + dx) + "," + (fy + dy) + " " + (fx + fw + dx) + "," + (fy + dy + fh) + " " + (fx + fw) + "," + (fy + fh), fill: "rgba(194,112,62,0.03)", stroke: "rgba(194,112,62,0.28)", strokeWidth: 0.8 }));

  // Front windows (12 floors x 5 cols)
  const hfI = floors - 7;
  for (let f = 0; f < floors; f++) {
    const isHL = f === hfI;
    for (let c = 0; c < cols; c++) {
      const wx = fx + c * colW + 3;
      const wy = fy + f * flH + 3;
      const ww = colW - 6;
      const wh = flH - 6;
      const br = isHL ? 0.14 + rng() * 0.14 : 0.05 + rng() * 0.16;
      els.push(E("rect", { key: "wf" + f + "_" + c, x: wx, y: wy, width: ww, height: wh, fill: "rgba(194,112,62," + br.toFixed(3) + ")", rx: 1 }));
    }
  }

  // Front floor lines
  for (let f = 1; f < floors; f++) {
    els.push(E("line", { key: "flf" + f, x1: fx, y1: fy + f * flH, x2: fx + fw, y2: fy + f * flH, stroke: "rgba(194,112,62,0.22)", strokeWidth: 0.6 }));
  }

  // Side windows (12 floors x 2 cols)
  for (let f = 0; f < floors; f++) {
    const isHL = f === hfI;
    for (let c = 0; c < 2; c++) {
      const d1 = (c * 20 + 3) / dx;
      const d2 = ((c + 1) * 20 - 3) / dx;
      const fyt = fy + f * flH + 3;
      const fyb = fy + (f + 1) * flH - 3;
      const x1 = fx + fw + d1 * dx;
      const x2 = fx + fw + d2 * dx;
      const y1t = fyt + d1 * dy;
      const y1b = fyb + d1 * dy;
      const y2t = fyt + d2 * dy;
      const y2b = fyb + d2 * dy;
      const br = isHL ? 0.08 + rng() * 0.1 : 0.03 + rng() * 0.09;
      els.push(E("polygon", { key: "ws" + f + "_" + c, points: x1 + "," + y1t + " " + x2 + "," + y2t + " " + x2 + "," + y2b + " " + x1 + "," + y1b, fill: "rgba(194,112,62," + br.toFixed(3) + ")" }));
    }
  }

  // Side floor lines
  for (let f = 1; f < floors; f++) {
    const ly = fy + f * flH;
    els.push(E("line", { key: "fls" + f, x1: fx + fw, y1: ly, x2: fx + fw + dx, y2: ly + dy, stroke: "rgba(194,112,62,0.14)", strokeWidth: 0.5 }));
  }

  // Highlighted floor 7 outline
  const hy = fy + hfI * flH;
  els.push(E("rect", { key: "hfo", x: fx, y: hy, width: fw, height: flH, fill: "none", stroke: "rgba(194,112,62,0.65)", strokeWidth: 1.3 }));
  els.push(E("polygon", { key: "hso", points: (fx + fw) + "," + hy + " " + (fx + fw + dx) + "," + (hy + dy) + " " + (fx + fw + dx) + "," + (hy + dy + flH) + " " + (fx + fw) + "," + (hy + flH), fill: "none", stroke: "rgba(194,112,62,0.5)", strokeWidth: 0.8 }));

  // Top edge glow
  els.push(E("line", { key: "tg1", x1: fx, y1: fy, x2: fx + fw, y2: fy, stroke: "rgba(194,112,62,0.7)", strokeWidth: 2 }));
  els.push(E("line", { key: "tg2", x1: fx + fw, y1: fy, x2: fx + fw + dx, y2: fy + dy, stroke: "rgba(194,112,62,0.45)", strokeWidth: 1.2 }));

  // Connecting lines + dots
  els.push(E("line", { key: "cl1", x1: fx + fw, y1: fy, x2: 355, y2: fy, stroke: "rgba(194,112,62,0.18)", strokeWidth: 0.5 }));
  els.push(E("circle", { key: "cd1", cx: fx + fw, cy: fy, r: 2.5, fill: "rgba(194,112,62,0.5)" }));
  els.push(E("line", { key: "cl2", x1: fx + fw + dx, y1: hy + dy + flH / 2, x2: 355, y2: 200, stroke: "rgba(194,112,62,0.18)", strokeWidth: 0.5 }));
  els.push(E("circle", { key: "cd2", cx: fx + fw + dx, cy: hy + dy + flH / 2, r: 2, fill: "rgba(194,112,62,0.4)" }));
  els.push(E("line", { key: "cl3", x1: 300, y1: 424, x2: 355, y2: 424, stroke: "rgba(194,112,62,0.18)", strokeWidth: 0.5 }));
  els.push(E("circle", { key: "cd3", cx: 300, cy: 424, r: 2, fill: "rgba(194,112,62,0.4)" }));
  els.push(E("line", { key: "cl4", x1: fx, y1: hy + flH / 2, x2: 55, y2: hy + flH / 2, stroke: "rgba(194,112,62,0.18)", strokeWidth: 0.5 }));
  els.push(E("circle", { key: "cd4", cx: fx, cy: hy + flH / 2, r: 2.5, fill: "rgba(194,112,62,0.5)" }));

  return E(
    "svg",
    { viewBox: "0 0 420 530", fill: "none", width: 380, height: 480, style: { overflow: "visible" } },
    els
  );
}

export function HeroBuilding() {
  return (
    <div
      className="relative flex min-h-[520px] flex-1 items-center justify-center"
      style={{ flex: "0 0 55%" }}
    >
      <div style={{ animation: "float 6s infinite ease-in-out", willChange: "transform" }}>
        {buildBuilding()}
      </div>

      {/* Attribute label pills */}
      <AttrPill className="right-0 top-[38px]">Height: 99.9 m</AttrPill>
      <AttrPill className="right-0 top-[195px]">27 floors</AttrPill>
      <AttrPill className="right-0 bottom-[72px]">54,000 m²</AttrPill>
      <AttrPill className="left-0 top-[200px]">Floor 7 · selected</AttrPill>

      {/* Structure icon: top left */}
      <div className="absolute left-0 top-[38px] flex items-center gap-2">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#C2703E" strokeWidth={1} opacity={0.6}>
          <rect x="3" y="2" width="14" height="16" rx="1" />
          <line x1="3" y1="6" x2="17" y2="6" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="14" x2="17" y2="14" />
        </svg>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#71717A]">
          Structure
        </span>
      </div>
    </div>
  );
}

function AttrPill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={"absolute flex items-center " + (className ?? "")}>
      <div
        className="whitespace-nowrap rounded-md border-[0.5px] px-3.5 py-1.5 font-mono text-[12px] text-[#C2703E]"
        style={{
          background: "rgba(17,17,20,0.85)",
          backdropFilter: "blur(8px)",
          borderColor: "rgba(194,112,62,0.15)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
