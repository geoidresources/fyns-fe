"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RevealOnScroll } from "@/components/marketing/terramine/RevealOnScroll";
import { IsometricCity } from "@/components/marketing/terramine/IsometricCity";
import { HeroBuilding } from "@/components/marketing/terramine/HeroBuilding";
import { PointCloudCity } from "@/components/marketing/terramine/PointCloudCity";

const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.12em] text-[#C2703E]";
const SECTION_TITLE =
  "text-[36px] font-medium leading-[1.15] tracking-[-0.01em] text-[#F4F4F5]";

const conceptPoints = [
  {
    title: "Centimeter-accurate measurement",
    desc: "Distance, area, volume — directly on the model",
  },
  {
    title: "Temporal comparison",
    desc: "Overlay scans from different dates to detect change",
  },
];

const applications = [
  {
    title: "Buildings",
    desc: "Individual structures — commercial, residential, industrial. Navigate floor-by-floor, measure any surface, track construction progress.",
    art: (
      <svg width="120" height="160" viewBox="0 0 120 160" fill="none" style={{ animation: "cardRotate 20s infinite ease-in-out alternate" }}>
        <rect x="25" y="10" width="70" height="140" stroke="rgba(194,112,62,0.25)" strokeWidth="1" />
        {[28, 46, 64, 82, 100, 118, 136].map((y) => (
          <line key={y} x1="25" y1={y} x2="95" y2={y} stroke="rgba(194,112,62,0.12)" />
        ))}
        <line x1="10" y1="150" x2="110" y2="150" stroke="rgba(194,112,62,0.06)" />
      </svg>
    ),
  },
  {
    title: "City districts",
    desc: "Neighborhoods and zones — urban planning, smart city infrastructure, zoning compliance. See every block in context.",
    art: (
      <svg width="180" height="140" viewBox="0 0 180 140" fill="none" style={{ animation: "cardRotate 20s infinite ease-in-out alternate" }}>
        <rect x="10" y="70" width="25" height="60" stroke="rgba(194,112,62,0.2)" strokeWidth="0.8" />
        <rect x="40" y="40" width="30" height="90" stroke="rgba(194,112,62,0.25)" strokeWidth="0.8" />
        <rect x="75" y="20" width="35" height="110" stroke="rgba(194,112,62,0.4)" strokeWidth="1" />
        <rect x="115" y="50" width="28" height="80" stroke="rgba(194,112,62,0.22)" strokeWidth="0.8" />
        <rect x="148" y="65" width="22" height="65" stroke="rgba(194,112,62,0.18)" strokeWidth="0.8" />
        <rect x="28" y="80" width="18" height="50" stroke="rgba(194,112,62,0.15)" strokeWidth="0.8" />
        <rect x="95" y="55" width="15" height="75" stroke="rgba(194,112,62,0.15)" strokeWidth="0.8" />
        <line x1="0" y1="130" x2="180" y2="130" stroke="rgba(194,112,62,0.06)" />
        <line x1="37" y1="0" x2="37" y2="130" stroke="rgba(194,112,62,0.04)" />
        <line x1="112" y1="0" x2="112" y2="130" stroke="rgba(194,112,62,0.04)" />
      </svg>
    ),
  },
  {
    title: "Infrastructure",
    desc: "Roads, bridges, pipelines, power grids, mine sites. Monitor structural integrity and plan maintenance from your browser.",
    art: (
      <svg width="200" height="120" viewBox="0 0 200 120" fill="none" style={{ animation: "cardRotate 20s infinite ease-in-out alternate" }}>
        <line x1="10" y1="50" x2="190" y2="50" stroke="rgba(194,112,62,0.3)" strokeWidth="1.5" />
        <line x1="10" y1="54" x2="190" y2="54" stroke="rgba(194,112,62,0.15)" strokeWidth="0.5" />
        <line x1="40" y1="50" x2="40" y2="110" stroke="rgba(194,112,62,0.25)" strokeWidth="1" />
        <line x1="100" y1="50" x2="100" y2="110" stroke="rgba(194,112,62,0.25)" strokeWidth="1" />
        <line x1="160" y1="50" x2="160" y2="110" stroke="rgba(194,112,62,0.25)" strokeWidth="1" />
        <path d="M10 50 Q55 15 100 50" stroke="rgba(194,112,62,0.18)" strokeWidth="0.8" fill="none" />
        <path d="M100 50 Q145 15 190 50" stroke="rgba(194,112,62,0.18)" strokeWidth="0.8" fill="none" />
        <line x1="55" y1="32" x2="55" y2="50" stroke="rgba(194,112,62,0.1)" strokeWidth="0.5" />
        <line x1="75" y1="25" x2="75" y2="50" stroke="rgba(194,112,62,0.1)" strokeWidth="0.5" />
        <line x1="125" y1="25" x2="125" y2="50" stroke="rgba(194,112,62,0.1)" strokeWidth="0.5" />
        <line x1="145" y1="32" x2="145" y2="50" stroke="rgba(194,112,62,0.1)" strokeWidth="0.5" />
        <line x1="0" y1="110" x2="200" y2="110" stroke="rgba(194,112,62,0.06)" />
      </svg>
    ),
  },
];

const workflow = [
  { title: "Capture", desc: "Fly your drone around the structure. Standard overlap, any DJI or LiDAR rig." },
  { title: "Upload", desc: "Drag images into TerraMine. Select Digital Twyn as destination. We handle processing." },
  { title: "Process", desc: "Cloud GPUs build your point cloud, mesh, and floor-segmented 3D model automatically." },
  { title: "Explore", desc: "Navigate, measure, annotate, and share your Twyn from any browser." },
];

const capabilities = [
  {
    title: "Floor isolation",
    desc: "Toggle individual floors on/off. Inspect structural elements level by level.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2703E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    title: "3D measurement",
    desc: "Point-to-point distance, surface area, room volume — all in the browser.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2703E" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 12h20M12 2v20" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    title: "Temporal comparison",
    desc: "Overlay Twyns from different dates. Detect settlement, deformation, or construction progress.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2703E" strokeWidth="1.5" strokeLinecap="round">
        <path d="M16 3h5v5" />
        <path d="M4 20L21 3" />
        <path d="M21 16v5h-5" />
        <path d="M14 14l7 7" />
      </svg>
    ),
  },
  {
    title: "Attribute query",
    desc: "Click any element to see height, area, material, classification, and metadata.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2703E" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
        <path d="M22 12h-4M6 12H2M12 6V2M12 22v-4" />
      </svg>
    ),
  },
  {
    title: "Export",
    desc: "Download and share via link with view-state preserved.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2703E" strokeWidth="1.5" strokeLinecap="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
  {
    title: "Compliance",
    desc: "Check building heights against zoning limits. Flag violations automatically.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2703E" strokeWidth="1.5" strokeLinecap="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
];

const ctaButtonStyle: React.CSSProperties = {
  background: "#C2703E",
  color: "#0A0D14",
  boxShadow: "0 0 32px rgba(194,112,62,0.2)",
};

function Divider() {
  return (
    <div className="flex justify-center">
      <div className="h-px w-[200px]" style={{ background: "rgba(194,112,62,0.06)" }} />
    </div>
  );
}

function StatsRow() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [vals, setVals] = useState({ s0: "0", s1: "0", s2: "0", s3: "0" });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let started = false;

    const countUp = () => {
      const start = performance.now();
      const tick = () => {
        const t = Math.min((performance.now() - start) / 2000, 1);
        const e = 1 - Math.pow(1 - t, 3);
        setVals({
          s0: (99.9 * e).toFixed(1) + "%",
          s1: "< " + Math.min(Math.ceil(2 * e + 0.01), 2) + " hrs",
          s2: Math.round(100 * e) + "M+",
          s3: String(Math.round(27 * e)),
        });
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !started) {
          started = true;
          countUp();
          io.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const stats = [
    { value: vals.s0, label: "GEOMETRIC ACCURACY" },
    { value: vals.s1, label: "PROCESSING TIME" },
    { value: vals.s2, label: "POINTS SUPPORTED" },
    { value: vals.s3, label: "FLOOR LEVELS MAX" },
  ];

  return (
    <div ref={ref} className="flex items-center justify-center">
      {stats.map((stat, i) => (
        <React.Fragment key={stat.label}>
          {i > 0 && <div className="h-10 w-px" style={{ background: "rgba(255,255,255,0.06)" }} />}
          <div className="flex-1 text-center">
            <div className="font-mono text-[36px] font-medium tabular-nums text-[#F4F4F5]">
              {stat.value}
            </div>
            <div className="mt-2 font-mono text-[12px] uppercase tracking-[0.1em] text-[#71717A]">
              {stat.label}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      {/* ═══ HERO ═══ */}
      <section className="relative flex h-screen items-center justify-center overflow-hidden">
        <IsometricCity />

        <div className="relative z-10 flex -translate-y-[12%] flex-col items-center text-center">
          <div
            className="mt-4 text-[52px] font-medium tracking-[-0.02em] text-[#F4F4F5]"
            style={{ textShadow: "0 0 60px rgba(194,112,62,0.15)" }}
          >
            Digital Twyn
          </div>
          <p className="mt-5 max-w-[540px] text-[15px] leading-[1.6] text-[#A1A1AA]">
            Create living 3D replicas of any structure. Navigate floor by floor. Measure wall to
            wall. Track change over time.
          </p>
          <Link
            href="/sign-up"
            className="mt-8 inline-flex items-center rounded-full px-8 py-3.5 text-[14px] font-medium no-underline transition-[transform,box-shadow] hover:-translate-y-0.5"
            style={ctaButtonStyle}
          >
            Get started →
          </Link>
          <a href="#concept" className="mt-4 text-[13px] text-[#71717A] no-underline">
            See it in action ↓
          </a>
        </div>

        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
          style={{ animation: "chevBounce 2s infinite ease-in-out" }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#71717A" strokeWidth="1.5">
            <path d="M5 8l5 5 5-5" />
          </svg>
        </div>
      </section>

      {/* ═══ THE CONCEPT ═══ */}
      <section id="concept" className="mx-auto max-w-[1200px] px-12 py-[120px]">
        <div className="flex flex-col items-start gap-16 lg:flex-row">
          <div className="min-w-0 flex-1">
            <RevealOnScroll className={EYEBROW}>THE CONCEPT</RevealOnScroll>
            <RevealOnScroll delay={0.1} className={`mt-4 ${SECTION_TITLE}`}>
              A living digital replica
            </RevealOnScroll>
            <RevealOnScroll delay={0.2} className="mt-5 text-[15px] leading-[1.65] text-[#A1A1AA]">
              A Digital Twyn is an interactive 3D model of a physical structure — built from drone
              imagery, photogrammetry, or LiDAR scans. Unlike static 3D models, a Digital Twyn is
              queryable: click any floor, wall, or surface to see its real-world dimensions,
              materials, and changes over time.
            </RevealOnScroll>
            <div className="mt-9 flex flex-col gap-5">
              {conceptPoints.map((point, i) => (
                <RevealOnScroll
                  key={point.title}
                  delay={0.3 + i * 0.1}
                  className="flex items-start gap-3.5"
                >
                  <div className="mt-[5px] h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: "#C2703E" }} />
                  <div>
                    <div className="text-[16px] font-medium text-[#F4F4F5]">{point.title}</div>
                    <div className="mt-1 text-[14px] text-[#A1A1AA]">{point.desc}</div>
                  </div>
                </RevealOnScroll>
              ))}
            </div>
          </div>

          <HeroBuilding />
        </div>
      </section>

      {/* ═══ POINT CLOUD CITY ═══ */}
      <PointCloudCity />

      {/* ═══ APPLICATIONS ═══ */}
      <Divider />
      <section className="mx-auto max-w-[1200px] px-12 py-[120px]">
        <div className="text-center">
          <RevealOnScroll className={EYEBROW}>APPLICATIONS</RevealOnScroll>
          <RevealOnScroll delay={0.1} className={`mt-4 ${SECTION_TITLE}`}>
            From a single building to an entire city
          </RevealOnScroll>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {applications.map((app, i) => (
            <RevealOnScroll
              key={app.title}
              delay={0.15 + i * 0.15}
              className="group overflow-hidden rounded-2xl border-[0.5px] border-white/[0.06] bg-[#111318] transition-[border-color,transform] hover:-translate-y-[3px] hover:border-[rgba(194,112,62,0.15)]"
            >
              <div
                className="flex h-[200px] items-center justify-center"
                style={{ background: "radial-gradient(circle at 50% 60%,rgba(194,112,62,0.04),transparent 70%)" }}
              >
                {app.art}
              </div>
              <div className="p-6">
                <div className="text-[20px] font-medium text-[#F4F4F5]">{app.title}</div>
                <div className="mt-2 text-[14px] leading-[1.5] text-[#A1A1AA]">{app.desc}</div>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* ═══ WORKFLOW ═══ */}
      <Divider />
      <section className="mx-auto max-w-[1200px] px-12 py-[120px]">
        <div className="text-center">
          <RevealOnScroll className={EYEBROW}>WORKFLOW</RevealOnScroll>
          <RevealOnScroll delay={0.1} className={`mt-4 ${SECTION_TITLE}`}>
            Four steps to your Digital Twyn
          </RevealOnScroll>
        </div>
        <div className="relative mt-16 flex flex-col items-start gap-12 md:flex-row md:gap-0">
          <div
            className="absolute left-4 right-4 top-4 hidden h-px md:block"
            style={{ background: "rgba(194,112,62,0.08)" }}
          />
          {workflow.map((step, i) => (
            <RevealOnScroll
              key={step.title}
              delay={0.15 + i * 0.15}
              className="relative flex flex-1 flex-col items-center px-3 text-center"
            >
              <div
                className="relative z-[1] flex h-8 w-8 items-center justify-center rounded-full font-mono text-[14px] font-medium text-[#C2703E]"
                style={{ border: "1.5px solid rgba(194,112,62,0.3)", background: "#111318" }}
              >
                {i + 1}
              </div>
              <div className="mt-5 text-[18px] font-medium text-[#F4F4F5]">{step.title}</div>
              <div className="mt-2 max-w-[200px] text-[13px] leading-[1.5] text-[#A1A1AA]">
                {step.desc}
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* ═══ CAPABILITIES ═══ */}
      <Divider />
      <section className="mx-auto max-w-[1200px] px-12 py-[120px]">
        <div className="text-center">
          <RevealOnScroll className={EYEBROW}>CAPABILITIES</RevealOnScroll>
          <RevealOnScroll delay={0.1} className={`mt-4 ${SECTION_TITLE}`}>
            Everything you need to explore your Twyn
          </RevealOnScroll>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((cap, i) => (
            <RevealOnScroll
              key={cap.title}
              delay={0.1 + i * 0.1}
              className="rounded-xl border-[0.5px] border-white/[0.06] bg-[#111318] p-6 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[rgba(194,112,62,0.12)]"
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ background: "rgba(194,112,62,0.06)" }}
              >
                {cap.icon}
              </div>
              <div className="mt-3 text-[16px] font-medium text-[#F4F4F5]">{cap.title}</div>
              <div className="mt-1.5 text-[13px] leading-[1.5] text-[#A1A1AA]">{cap.desc}</div>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* ═══ STATS ═══ */}
      <section className="mx-auto max-w-[1200px] px-12 py-20">
        <StatsRow />
      </section>

      {/* ═══ CTA ═══ */}
      <section id="cta" className="relative px-12 py-[120px]">
        <div
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{
            width: 500,
            height: 500,
            transform: "translate(-50%,-50%)",
            background: "radial-gradient(circle,rgba(194,112,62,0.04) 0%,transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-[600px] text-center">
          <RevealOnScroll className={SECTION_TITLE}>Build your first Digital Twyn</RevealOnScroll>
          <RevealOnScroll delay={0.1} className="mt-4 text-[15px] leading-[1.6] text-[#A1A1AA]">
            Upload drone images. Get a navigable 3D model. No software to install.
          </RevealOnScroll>
          <RevealOnScroll delay={0.2}>
            <Link
              href="/sign-up"
              className="mt-8 inline-flex items-center rounded-full px-8 py-3.5 text-[14px] font-medium no-underline transition-[transform,box-shadow] hover:-translate-y-0.5"
              style={ctaButtonStyle}
            >
              Get started →
            </Link>
          </RevealOnScroll>
          <RevealOnScroll delay={0.3} className="mt-4 text-[13px] text-[#71717A]">
            Or contact us at{" "}
            <a href="mailto:contact@geoidresources.com" className="text-[#A1A1AA] no-underline hover:text-[#C2703E]">
              contact@geoidresources.com
            </a>
          </RevealOnScroll>
        </div>
      </section>
    </>
  );
}
