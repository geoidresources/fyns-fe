"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Download,
  History,
  Info,
  Layers,
  Ruler,
  ShieldCheck,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Building04Icon,
  City01Icon,
  RoadIcon,
  CheckmarkCircle01Icon,
  DroneIcon,
  CloudUploadIcon,
  CpuIcon,
  CompassIcon,
} from "@hugeicons/core-free-icons";
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
    art: <HugeiconsIcon icon={Building04Icon} size={72} color="rgba(194,112,62,0.55)" strokeWidth={1} />,
  },
  {
    title: "City districts",
    desc: "Neighborhoods and zones — urban planning, smart city infrastructure, zoning compliance. See every block in context.",
    art: <HugeiconsIcon icon={City01Icon} size={72} color="rgba(194,112,62,0.55)" strokeWidth={1} />,
  },
  {
    title: "Infrastructure",
    desc: "Roads, bridges, pipelines, power grids, mine sites. Monitor structural integrity and plan maintenance from your browser.",
    art: <HugeiconsIcon icon={RoadIcon} size={72} color="rgba(194,112,62,0.55)" strokeWidth={1} />,
  },
];

const workflow = [
  { title: "Capture", desc: "Fly your drone around the structure. Standard overlap, any DJI or LiDAR rig.", icon: DroneIcon },
  { title: "Upload", desc: "Drag images into TerraMine. Select Digital Twyn as destination. We handle processing.", icon: CloudUploadIcon },
  { title: "Process", desc: "Cloud GPUs build your point cloud, mesh, and floor-segmented 3D model automatically.", icon: CpuIcon },
  { title: "Explore", desc: "Navigate, measure, annotate, and share your Twyn from any browser.", icon: CompassIcon },
];

const CAP_ICON = { size: 24, strokeWidth: 1.5, color: "#C2703E" } as const;

const capabilities = [
  {
    title: "Floor isolation",
    desc: "Toggle individual floors on/off. Inspect structural elements level by level.",
    icon: <Layers {...CAP_ICON} />,
  },
  {
    title: "3D measurement",
    desc: "Point-to-point distance, surface area, room volume — all in the browser.",
    icon: <Ruler {...CAP_ICON} />,
  },
  {
    title: "Temporal comparison",
    desc: "Overlay Twyns from different dates. Detect settlement, deformation, or construction progress.",
    icon: <History {...CAP_ICON} />,
  },
  {
    title: "Attribute query",
    desc: "Click any element to see height, area, material, classification, and metadata.",
    icon: <Info {...CAP_ICON} />,
  },
  {
    title: "Export",
    desc: "Download and share via link with view-state preserved.",
    icon: <Download {...CAP_ICON} />,
  },
  {
    title: "Compliance",
    desc: "Check building heights against zoning limits. Flag violations automatically.",
    icon: <ShieldCheck {...CAP_ICON} />,
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
            className="mt-8 inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-[14px] font-medium no-underline transition-[transform,box-shadow] hover:-translate-y-0.5"
            style={ctaButtonStyle}
          >
            Get started <ArrowRight size={16} strokeWidth={2} />
          </Link>
          <a
            href="#concept"
            className="mt-4 inline-flex items-center gap-1 text-[13px] text-[#71717A] no-underline"
          >
            See it in action <ArrowDown size={14} strokeWidth={1.5} />
          </a>
        </div>

        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
          style={{ animation: "chevBounce 2s infinite ease-in-out" }}
        >
          <ChevronDown size={20} strokeWidth={1.5} color="#71717A" />
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
                  <HugeiconsIcon icon={CheckmarkCircle01Icon} size={18} color="#C2703E" strokeWidth={1.5} className="mt-[2px] flex-shrink-0" />
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
                className="relative z-[1] flex h-10 w-10 items-center justify-center rounded-full"
                style={{ border: "1.5px solid rgba(194,112,62,0.3)", background: "#111318" }}
              >
                <HugeiconsIcon icon={step.icon} size={20} color="#C2703E" strokeWidth={1.5} />
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
              className="mt-8 inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-[14px] font-medium no-underline transition-[transform,box-shadow] hover:-translate-y-0.5"
              style={ctaButtonStyle}
            >
              Get started <ArrowRight size={16} strokeWidth={2} />
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
