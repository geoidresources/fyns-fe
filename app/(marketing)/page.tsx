"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Play, ArrowRight, Layers, Ruler, TriangleAlert, Cpu, Droplet, Move3d, Globe } from "lucide-react";
import { motion } from "framer-motion";

// Lazy load the 3D globe to avoid blocking initial render
const HeroGlobe = dynamic(() => import("@/components/marketing/HeroGlobe").then(mod => mod.HeroGlobe), { ssr: false });

export default function LandingPage() {
  return (
    <div className="flex flex-col gap-24 pb-20">
      
      {/* 1. Hero Section */}
      <section className="relative pt-10 md:pt-20">
        <div className="container mx-auto px-4 flex flex-col md:flex-col items-center text-center">
          
          <div className="w-full max-w-4xl mx-auto mb-10 md:mb-16">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-balance mb-6 leading-tight">
              The mine, mapped.<br/>The risk, visible.
            </h1>
            <p className="text-lg md:text-xl text-[#9CA3AF] mb-10">
              Drone survey to decision platform for mining, quarrying, and civil works.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" className="w-full sm:w-auto px-8">Start free trial</Button>
              <Button variant="ghost" size="lg" className="w-full sm:w-auto gap-2">
                <Play className="w-4 h-4" /> Watch demo
              </Button>
            </div>
          </div>

          <div className="w-full relative h-[400px] md:h-[600px] rounded-3xl overflow-hidden">
            <HeroGlobe />
          </div>

        </div>

        {/* Metrics Banner */}
        <div className="container mx-auto px-4 mt-16">
          <div className="flex flex-wrap justify-center gap-4 md:gap-8">
            {[
              { value: "14", label: "SITES" },
              { value: "Weekly", label: "SURVEY CADENCE" },
              { value: "0.5m", label: "VERIFICATION" },
              { value: "cm-level", label: "LiDAR Z-ACCURACY" }
            ].map((metric, i) => (
              <div key={i} className="px-6 py-4 rounded-full border border-white/5 bg-[#1A1D24]/80 backdrop-blur-md flex items-baseline gap-2">
                <span className="text-white font-semibold">{metric.value}</span>
                <span className="text-xs text-[#9CA3AF] tracking-widest uppercase">{metric.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2. Platform Overview */}
      <section className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center gap-16">
          <div className="w-full md:w-1/2 flex flex-col gap-8">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">One map. Every decision.</h2>
              <p className="text-[#9CA3AF] text-lg">
                Upload surveys, measure stockpiles, compare designs, generate reports — all in one unified map view. Built for the mining survey cycle.
              </p>
            </div>
            
            <div className="space-y-6">
              {[
                { title: "Survey to report in 10 minutes", desc: "Upload drone or LiDAR data, process automatically, measure and report." },
                { title: "Every number has a receipt", desc: "Full provenance tracking for volumes, areas, and measurements." },
                { title: "Mining-grade safety modules", desc: "Highwall monitoring, slope analysis, and risk alerts built-in." }
              ].map((item, i) => (
                <div key={i} className="flex gap-4">
                  <div className="mt-1 w-6 h-6 rounded bg-[#C97A4E]/20 flex items-center justify-center text-[#C97A4E] shrink-0">
                    <div className="w-2 h-2 rounded-sm bg-[#C97A4E]" />
                  </div>
                  <div>
                    <h4 className="text-white font-medium mb-1">{item.title}</h4>
                    <p className="text-[#9CA3AF] text-sm">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <Button variant="secondary" className="mt-4">Explore platform</Button>
            </div>
          </div>

          <div className="w-full md:w-1/2">
            <div className="aspect-square md:aspect-[4/3] rounded-2xl border border-white/5 bg-[#12141A] flex flex-col items-center justify-center p-8 shadow-2xl">
              <Globe className="w-16 h-16 text-[#C97A4E] mb-4 opacity-50" />
              <p className="text-[#6B7280]">Dashboard Preview</p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Feature Grid */}
      <section className="container mx-auto px-4 pt-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Built for the survey cycle.</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: <Layers className="w-5 h-5" />, title: "Stockpile volumes", desc: "Smart base detection, material density, tonnage with reproducibility receipts." },
            { icon: <Ruler className="w-5 h-5" />, title: "Cut / fill analysis", desc: "Survey vs design, survey vs survey, with deadband control and per-zone breakdown." },
            { icon: <Move3d className="w-5 h-5" />, title: "Road monitoring", desc: "Grade, crossfall, width compliance, ponding detection, maintenance register." },
            { icon: <TriangleAlert className="w-5 h-5" />, title: "Slope and safety", desc: "Backbreak detection, slope threshold alerts, rainfall-triggered reviews." },
            { icon: <Cpu className="w-5 h-5" />, title: "AI feature extraction", desc: "Toe/crest, road edges, stockpile footprints with confidence scoring." },
            { icon: <Droplet className="w-5 h-5" />, title: "Hydro analysis", desc: "Catchment delineation, flow paths, ponding detection, drain compliance." }
          ].map((feature, i) => (
            <Card key={i} className="bg-[#12141A] border-white/5 hover:border-white/10 transition-colors group cursor-pointer">
              <CardHeader>
                <div className="w-10 h-10 rounded bg-[#C97A4E]/10 flex items-center justify-center text-[#C97A4E] mb-4">
                  {feature.icon}
                </div>
                <CardTitle>{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="mb-6 h-12">{feature.desc}</CardDescription>
                <div className="flex items-center text-sm font-medium text-[#9CA3AF] group-hover:text-white transition-colors">
                  Learn more <ArrowRight className="w-4 h-4 ml-1 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* 4. CTA Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-balance">
          Start mapping your mine.
        </h2>
        <p className="text-lg text-[#9CA3AF] mb-10 max-w-2xl mx-auto">
          14-day free trial. No credit card. Upload your first survey in 10 minutes.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button size="lg" className="px-8">Start free trial</Button>
          <Button variant="secondary" size="lg" className="px-8">Talk to sales</Button>
        </div>
      </section>
    </div>
  );
}
