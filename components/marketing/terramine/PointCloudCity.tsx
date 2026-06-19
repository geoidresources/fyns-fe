"use client";

import React, { useEffect, useRef } from "react";

interface Dot {
  x: number;
  y: number;
  a: number;
  s: number;
}

/**
 * Animated point-cloud city, ported faithfully from the TerraMine design export
 * (`_initCanvas` / `_draw`). A scan line sweeps vertically, briefly brightening
 * nearby points. Starts once the canvas scrolls into view.
 */
export function PointCloudCity() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let started = false;

    let dots: Dot[] = [];
    let cW = 0;
    let cH = 520;
    let sy = 520;

    const init = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const W = parent.offsetWidth;
      const H = 520;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const next: Dot[] = [];
      const bc = Math.floor(W / 28);
      for (let i = 0; i < bc; i++) {
        const cf = 1 - Math.abs(i - bc / 2) / (bc / 2);
        const bh = (40 + Math.random() * 140) * (0.3 + cf * 0.7);
        const bx = i * (W / bc);
        const bw = W / bc - 3;
        const by = H - bh - 25;
        const cnt = Math.floor(bw * bh * 0.08);
        const ef = Math.abs(i - bc / 2) / bc;
        for (let j = 0; j < cnt; j++) {
          const dx = bx + Math.random() * bw;
          const dy = by + Math.random() * bh;
          const de = Math.min(dx - bx, bx + bw - dx, dy - by, by + bh - dy);
          next.push({
            x: dx,
            y: dy,
            a: Math.min((0.05 + Math.random() * 0.3 + (de < 3 ? 0.2 : 0)) * (1 - ef * 0.7), 0.6),
            s: 1 + Math.random() * 0.5,
          });
        }
      }
      for (let i = 0; i < W * 0.25; i++) {
        next.push({ x: Math.random() * W, y: H - 25 + Math.random() * 18, a: 0.05 + Math.random() * 0.1, s: 1 });
      }
      for (let i = 0; i < 25; i++) {
        next.push({ x: Math.random() * W, y: Math.random() * (H - 50), a: 0.02 + Math.random() * 0.06, s: 1 });
      }
      dots = next;
      cW = W;
      cH = H;
      sy = H;
      draw(ctx);
    };

    const draw = (ctx: CanvasRenderingContext2D) => {
      const W = cW;
      const H = cH;
      ctx.clearRect(0, 0, W, H);
      sy -= 0.6;
      if (sy < -15) sy = H + 15;
      for (const d of dots) {
        let a = d.a;
        const dist = Math.abs(d.y - sy);
        if (dist < 18) a = Math.min(a + 0.25 * (1 - dist / 18), 0.8);
        ctx.fillStyle = "rgba(194,112,62," + a + ")";
        ctx.fillRect(d.x, d.y, d.s, d.s);
      }
      ctx.strokeStyle = "rgba(194,112,62,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();
      raf = requestAnimationFrame(() => draw(ctx));
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !started) {
          started = true;
          init();
          io.disconnect();
        }
      },
      { threshold: 0.05 }
    );
    io.observe(canvas);

    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="py-20">
      <div className="relative h-[520px] w-full">
        <canvas ref={canvasRef} className="block h-[520px] w-full" />
      </div>
      <div
        className="flex h-12 items-center justify-center"
        style={{ background: "rgba(17,17,20,0.8)", backdropFilter: "blur(16px)" }}
      >
        <div className="flex flex-wrap justify-center gap-1.5 font-mono text-[13px] text-[#71717A]">
          <span>
            <span className="text-[#C2703E]">4.2M</span> points
          </span>
          <span>·</span>
          <span>
            <span className="text-[#C2703E]">847</span> buildings
          </span>
          <span>·</span>
          <span>
            <span className="text-[#C2703E]">12</span> city blocks
          </span>
          <span>·</span>
          <span>
            processed in <span className="text-[#C2703E]">23</span> minutes
          </span>
        </div>
      </div>
    </section>
  );
}
