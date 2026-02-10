import { useState, useEffect, useCallback, useRef } from "react";
import heroImage from "@/assets/chicago-skyline-hero.jpg";
import screenshotViewer from "@/assets/screenshot-viewer.png";
import screenshotAiScan from "@/assets/screenshot-ai-scan.png";
import screenshotMobile from "@/assets/screenshot-mobile.png";
import screenshotGunnar from "@/assets/screenshot-gunnar.png";
import {
  Building2,
  Eye,
  Brain,
  MessageSquare,
  Smartphone,
  QrCode,
  Server,
  Layers,
  Camera,
  Scan,
  Mic,
  FileText,
  AlertTriangle,
  Database,
  Globe,
  Zap,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Download,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Slide components                                                   */
/* ------------------------------------------------------------------ */

const TitleSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/60 to-black/40" />
    <div className="relative z-10 flex flex-col items-center justify-center h-full text-white px-24">
      <div className="flex items-center gap-6 mb-8">
        <Building2 className="w-20 h-20 text-cyan-400" />
        <h1 className="text-[120px] font-bold leading-none tracking-tight">Geminus</h1>
      </div>
      <p className="text-[42px] font-light text-cyan-300 mb-6">Your Digital Twin Platform</p>
      <p className="text-[28px] text-white/70 max-w-[900px] text-center">
        A unified platform for managing, visualizing and understanding buildings — with 3D, 360°, AI and IoT.
      </p>
    </div>
  </div>
);

const ProblemSlide = () => (
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-16 text-red-400">The Problem</h2>
    <div className="grid grid-cols-2 gap-12">
      {[
        { icon: Database, title: "Fragmented data", desc: "BIM, operations, IoT, documents — all in separate systems with no connection." },
        { icon: AlertTriangle, title: "Lack of overview", desc: "No unified picture of building condition and assets." },
        { icon: FileText, title: "Manual inventory", desc: "Time-consuming, error-prone and rarely kept up to date." },
        { icon: Globe, title: "Poor accessibility", desc: "Information requires specialized tools and experts to access." },
      ].map(({ icon: Icon, title, desc }) => (
        <div key={title} className="flex gap-6 items-start">
          <div className="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center shrink-0">
            <Icon className="w-8 h-8 text-red-400" />
          </div>
          <div>
            <h3 className="text-[32px] font-semibold mb-2">{title}</h3>
            <p className="text-[24px] text-white/70 leading-relaxed">{desc}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const SolutionSlide = () => (
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-cyan-950 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-6 text-cyan-400">The Solution</h2>
    <p className="text-[28px] text-white/60 mb-16 max-w-[1200px]">
      Geminus unifies all building data into a digital twin — accessible for everyone, everywhere.
    </p>
    <div className="grid grid-cols-4 gap-10">
      {[
        { icon: Layers, label: "3D BIM", desc: "xeokit-based viewer with IFC models" },
        { icon: Camera, label: "360° Panorama", desc: "NavVis Ivion integration with room navigation" },
        { icon: Brain, label: "AI Assistants", desc: "Ask Gunnar about data, Ilean about documents" },
        { icon: Zap, label: "IoT & Sensors", desc: "Real-time data from Senslinc sensors" },
      ].map(({ icon: Icon, label, desc }) => (
        <div key={label} className="flex flex-col items-center text-center bg-white/5 rounded-3xl p-8 border border-white/10">
          <div className="w-20 h-20 rounded-full bg-cyan-500/20 flex items-center justify-center mb-6">
            <Icon className="w-10 h-10 text-cyan-400" />
          </div>
          <h3 className="text-[28px] font-semibold mb-3">{label}</h3>
          <p className="text-[20px] text-white/60 leading-relaxed">{desc}</p>
        </div>
      ))}
    </div>
  </div>
);

const ViewerSlide = () => (
  <div className="flex h-full bg-gradient-to-br from-slate-900 to-indigo-950 text-white px-32 py-16">
    <div className="flex-1 flex flex-col justify-center pr-12">
      <h2 className="text-[64px] font-bold mb-6 text-indigo-400">3D + 360° Viewer</h2>
      <p className="text-[24px] text-white/60 mb-10">
        Explore buildings in 3D models and 360° panoramas — side by side or as a Virtual Twin.
      </p>
      <div className="space-y-6">
        {[
          { icon: Layers, title: "BIM Models", items: "xeokit WebGL rendering, IFC→XKT conversion, object selection & properties" },
          { icon: Eye, title: "360° Integration", items: "NavVis Ivion SDK, camera sync 3D↔360°, POI markers with symbols" },
          { icon: Building2, title: "View Modes", items: "Split View, Virtual Twin overlay, room visualization, architect & x-ray mode" },
        ].map(({ icon: Icon, title, items }) => (
          <div key={title} className="flex gap-4 items-start">
            <Icon className="w-8 h-8 text-indigo-400 shrink-0 mt-1" />
            <div>
              <h3 className="text-[24px] font-semibold">{title}</h3>
              <p className="text-[18px] text-white/50">{items}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
    <div className="w-[700px] shrink-0 flex items-center">
      <img src={screenshotViewer} alt="3D Viewer" className="w-full rounded-2xl border border-white/10 shadow-2xl" />
    </div>
  </div>
);

const AiDetectionSlide = () => (
  <div className="flex h-full bg-gradient-to-br from-slate-900 to-emerald-950 text-white px-32 py-16">
    <div className="flex-1 flex flex-col justify-center pr-12">
      <h2 className="text-[64px] font-bold mb-6 text-emerald-400">AI Asset Detection</h2>
      <p className="text-[24px] text-white/60 mb-10 max-w-[800px]">
        Automated inventory directly from 360° panorama images — powered by Google Gemini.
      </p>
      <div className="space-y-6">
        {[
          { step: "1", title: "Configure", desc: "Select building, detection templates and image source from Ivion." },
          { step: "2", title: "Scan", desc: "AI analyzes each panorama image and identifies objects with bounding boxes." },
          { step: "3", title: "Review", desc: "Detections land in a review queue with confidence scores." },
          { step: "4", title: "Register", desc: "Approved detections are automatically created as assets with POI in Ivion." },
        ].map(({ step, title, desc }) => (
          <div key={step} className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-full bg-emerald-500/30 flex items-center justify-center shrink-0">
              <span className="text-[20px] font-bold text-emerald-400">{step}</span>
            </div>
            <div>
              <h3 className="text-[22px] font-semibold">{title}</h3>
              <p className="text-[18px] text-white/50">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
    <div className="w-[700px] shrink-0 flex items-center">
      <img src={screenshotAiScan} alt="AI Detection" className="w-full rounded-2xl border border-white/10 shadow-2xl" />
    </div>
  </div>
);

const AiAssistantsSlide = () => (
  <div className="flex h-full bg-gradient-to-br from-slate-900 to-purple-950 text-white px-32 py-16">
    <div className="flex-1 flex flex-col justify-center pr-12">
      <h2 className="text-[64px] font-bold mb-6 text-purple-400">AI Assistants</h2>
      <p className="text-[24px] text-white/60 mb-10">
        Ask questions about the building in natural language — or use voice commands.
      </p>
      <div className="space-y-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <MessageSquare className="w-8 h-8 text-amber-400" />
            <h3 className="text-[28px] font-semibold text-amber-400">Gunnar</h3>
          </div>
          <p className="text-[20px] text-white/60 mb-1">Data assistant — answers questions about assets, rooms, areas and work orders.</p>
          <p className="text-[18px] text-white/40 italic">"How many fire extinguishers are on floor 3?"</p>
        </div>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-8 h-8 text-rose-400" />
            <h3 className="text-[28px] font-semibold text-rose-400">Ilean</h3>
          </div>
          <p className="text-[20px] text-white/60 mb-1">Document assistant — searches and summarizes drawings, manuals and instructions.</p>
          <p className="text-[18px] text-white/40 italic">"Show the ventilation diagram for fan room B2."</p>
        </div>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Mic className="w-8 h-8 text-cyan-400" />
            <h3 className="text-[28px] font-semibold text-cyan-400">Voice Control</h3>
          </div>
          <p className="text-[20px] text-white/60">Web Speech API for hands-free navigation. Control camera, search objects and ask questions by voice.</p>
        </div>
      </div>
    </div>
    <div className="w-[400px] shrink-0 flex items-center">
      <img src={screenshotGunnar} alt="Gunnar Chat" className="w-full rounded-2xl border border-white/10 shadow-2xl" />
    </div>
  </div>
);

const MobileSlide = () => (
  <div className="flex h-full bg-gradient-to-br from-slate-900 to-orange-950 text-white px-32 py-16">
    <div className="flex-1 flex flex-col justify-center pr-12">
      <h2 className="text-[64px] font-bold mb-6 text-orange-400">Mobile & QR</h2>
      <p className="text-[24px] text-white/60 mb-10">
        Fully responsive design — with specialized mobile flows for field workers.
      </p>
      <div className="space-y-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <QrCode className="w-8 h-8 text-orange-400" />
            <h3 className="text-[28px] font-semibold">QR Fault Reporting</h3>
          </div>
          <p className="text-[20px] text-white/60">Scan a QR code on an asset → open fault report directly on mobile without login. Photo, describe, submit.</p>
        </div>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Smartphone className="w-8 h-8 text-orange-400" />
            <h3 className="text-[28px] font-semibold">Mobile Inventory</h3>
          </div>
          <p className="text-[20px] text-white/60">Step-by-step wizard with GPS detection, category selector and quick registration of new assets in the field.</p>
        </div>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Eye className="w-8 h-8 text-orange-400" />
            <h3 className="text-[28px] font-semibold">Mobile Viewers</h3>
          </div>
          <p className="text-[20px] text-white/60">Full-screen 3D and 360° viewers optimized for mobile devices with touch gestures.</p>
        </div>
      </div>
    </div>
    <div className="w-[320px] shrink-0 flex items-center justify-center">
      <img src={screenshotMobile} alt="Mobile view" className="h-[700px] rounded-[2rem] border-4 border-white/10 shadow-2xl object-cover" />
    </div>
  </div>
);

const TechSlide = () => (
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-6 text-cyan-400">Technology & Architecture</h2>
    <p className="text-[28px] text-white/60 mb-14">
      Built with modern web technologies and cloud services — no server needed.
    </p>
    <div className="grid grid-cols-2 gap-10">
      <div className="bg-white/5 rounded-3xl p-8 border border-white/10">
        <h3 className="text-[28px] font-semibold mb-6 text-cyan-400">Frontend</h3>
        <div className="space-y-4">
          {["React 18 + TypeScript", "Vite — fast development & HMR", "Tailwind CSS + shadcn/ui", "xeokit SDK — WebGL BIM rendering", "NavVis Ivion SDK — 360° panorama", "Mapbox GL — map view with clusters"].map((t) => (
            <p key={t} className="text-[22px] text-white/70 flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-cyan-400" />{t}</p>
          ))}
        </div>
      </div>
      <div className="bg-white/5 rounded-3xl p-8 border border-white/10">
        <h3 className="text-[28px] font-semibold mb-6 text-cyan-400">Backend & Integrations</h3>
        <div className="space-y-4">
          {["Lovable Cloud — database, auth, storage", "Edge Functions — Deno-based serverless", "Asset+ FM API — asset & facility data", "NavVis Ivion API — POI & panorama data", "Senslinc API — IoT sensor data", "Google Gemini — AI vision & chat"].map((t) => (
            <p key={t} className="text-[22px] text-white/70 flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-cyan-400" />{t}</p>
          ))}
        </div>
      </div>
    </div>
    <div className="mt-10 flex items-center justify-center gap-4">
      <Server className="w-8 h-8 text-cyan-400/60" />
      <p className="text-[22px] text-white/40">Fully serverless — built and hosted on Lovable</p>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide registry                                                     */
/* ------------------------------------------------------------------ */

const slides = [
  TitleSlide,
  ProblemSlide,
  SolutionSlide,
  ViewerSlide,
  AiDetectionSlide,
  AiAssistantsSlide,
  MobileSlide,
  TechSlide,
];

/* ------------------------------------------------------------------ */
/*  Presentation shell                                                 */
/* ------------------------------------------------------------------ */

const SLIDE_W = 1920;
const SLIDE_H = 1080;

export default function Presentation() {
  const [current, setCurrent] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const computeScale = useCallback(() => {
    const sx = window.innerWidth / SLIDE_W;
    const sy = window.innerHeight / SLIDE_H;
    setScale(Math.min(sx, sy));
  }, []);

  useEffect(() => {
    computeScale();
    window.addEventListener("resize", computeScale);
    return () => window.removeEventListener("resize", computeScale);
  }, [computeScale]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setCurrent((p) => Math.min(p + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrent((p) => Math.max(p - 1, 0));
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "Escape" && isFullscreen) {
        document.exitFullscreen?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  const SlideComponent = slides[current];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black overflow-hidden select-none cursor-default"
      onClick={(e) => {
        const x = e.clientX / window.innerWidth;
        if (x > 0.5) setCurrent((p) => Math.min(p + 1, slides.length - 1));
        else setCurrent((p) => Math.max(p - 1, 0));
      }}
    >
      {/* Scaled slide with fade-in transition */}
      <div
        className="absolute"
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          left: "50%",
          top: "50%",
          marginLeft: -(SLIDE_W / 2),
          marginTop: -(SLIDE_H / 2),
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <div key={current} className="w-full h-full overflow-hidden rounded-sm animate-fade-in">
          <SlideComponent />
        </div>
      </div>

      {/* Controls overlay */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-6 py-4 z-50">
        <div className="flex-1 mx-4 h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${((current + 1) / slides.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Slide counter */}
      <div className="absolute top-4 right-4 z-50 text-white/50 text-sm font-mono">
        {current + 1} / {slides.length}
      </div>

      {/* Nav arrows */}
      <button
        className="absolute left-4 top-1/2 -translate-y-1/2 z-50 text-white/30 hover:text-white/70 transition-colors"
        onClick={(e) => { e.stopPropagation(); setCurrent((p) => Math.max(p - 1, 0)); }}
      >
        <ChevronLeft className="w-12 h-12" />
      </button>
      <button
        className="absolute right-4 top-1/2 -translate-y-1/2 z-50 text-white/30 hover:text-white/70 transition-colors"
        onClick={(e) => { e.stopPropagation(); setCurrent((p) => Math.min(p + 1, slides.length - 1)); }}
      >
        <ChevronRight className="w-12 h-12" />
      </button>

      {/* Top-left controls */}
      <div className="absolute top-4 left-4 z-50 flex gap-2">
        <button
          className="text-white/30 hover:text-white/70 transition-colors"
          onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
        >
          {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
        </button>
        <a
          href="/geminus-presentation.html"
          download
          className="text-white/30 hover:text-white/70 transition-colors"
          onClick={(e) => e.stopPropagation()}
          title="Download standalone presentation"
        >
          <Download className="w-6 h-6" />
        </a>
      </div>
    </div>
  );
}
