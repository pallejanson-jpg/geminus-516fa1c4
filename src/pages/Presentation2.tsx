import { useState, useEffect, useCallback, useRef } from "react";
import heroImage from "@/assets/chicago-skyline-hero.jpg";
import screenshotViewer from "@/assets/screenshot-viewer.png";
import screenshotAiScan from "@/assets/screenshot-ai-scan.png";
import screenshotMobile from "@/assets/screenshot-mobile.png";
import screenshotGunnar from "@/assets/screenshot-gunnar.png";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Download,
  Timer,
  X,
  Zap,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Rocket,
  Code2,
  Brain,
  Layers,
  Eye,
  Cpu,
  Radio,
  BarChart3,
  MessageSquare,
  Scan,
  Globe,
  Thermometer,
  HelpCircle,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Speaker Notes                                                      */
/* ------------------------------------------------------------------ */

const SLIDE_TITLES = [
  "Title — Geminus: From Idea to Production",
  "The Problem I Saw",
  "Why Lovable — Vibe-Coding",
  "My Journey — Timeline",
  "The Stack",
  "Feature: Digital Twin",
  "Feature: AI Assistants",
  "Feature: AI Asset Scan",
  "Feature: Integrations Hub",
  "Feature: IoT & Insights",
  "Do's and Don'ts",
  "Key Takeaways + Q&A",
];

const NOTES: string[][] = [
  // 1 — Title
  [
    "Welcome everyone. I'm Pål Janson — Product Solution Manager at Service Works Global.",
    "Today I'll share what I've built with Lovable in the Addnode Innovation competition.",
    "This is a showcase of Geminus — a digital twin platform I built solo in 3 months.",
    "I'll cover my vibe-coding journey, show you the coolest features, and share tips.",
  ],
  // 2 — Problem
  [
    "Buildings generate data in 10+ systems that never talk to each other.",
    "Addnode owns companies covering AEC and O — but there's no connective layer.",
    "Facility managers waste 30% of their time just finding information.",
    "I saw the gap and decided to build a bridge — using AI-assisted development.",
  ],
  // 3 — Why Lovable
  [
    "Vibe-coding means describing what you want in natural language and the AI writes the code.",
    "Lovable gave me a full React + Vite + Tailwind stack with Supabase backend — instant.",
    "I could iterate at the speed of thought — describe a feature, see it live in seconds.",
    "The comparison: what would take a 3-person dev team 12-18 months, I did solo in 3 months.",
    "This is not a toy — it's production-grade code with real API integrations.",
  ],
  // 4 — Timeline
  [
    "Week 1-2: First prototype — basic viewer shell, navigation, building selector.",
    "Week 3-4: First API integration with Asset+ — real building data flowing in.",
    "Week 5-6: xeokit 3D engine integrated, IFC models loading in browser.",
    "Week 7-8: AI asset scanning — computer vision on 360° panoramas.",
    "Week 9-10: Ivion 360° integration, split-view, virtual twin overlay.",
    "Week 11-12: IoT dashboards, AI assistants, mobile optimization, production hardening.",
  ],
  // 5 — Stack
  [
    "Frontend: React 18 + Vite + Tailwind CSS + TypeScript — all managed by Lovable.",
    "Backend: Supabase — PostgreSQL, Edge Functions, Auth, Storage — zero server management.",
    "3D Engine: xeokit-sdk — open-source WebGL viewer for large IFC/BIM models.",
    "360°: NavVis IVION SDK — panoramic imagery with point-of-interest overlays.",
    "APIs: Asset+ (FM), Senslinc (IoT), FM Access, Mapbox, Cesium, Google Routes.",
    "AI: Gemini and GPT models via Lovable AI — no API keys needed.",
  ],
  // 6 — Digital Twin
  [
    "The core of Geminus: a 3D digital twin of any building synced with Asset+.",
    "Floor switching, room visualization with color-coded overlays.",
    "Split view: 3D model on one side, 360° panorama on the other — camera synced.",
    "Room labels show live data — occupancy, temperature, area — right on the 3D model.",
    "This is where I'll do the first part of the live demo.",
  ],
  // 7 — AI Assistants
  [
    "Gunnar is the operations AI — ask questions about the building in natural language.",
    "He has context: building data, Asset+ properties, sensor readings, maintenance history.",
    "Ilean is the contextual AI — appears in the viewer, knows what you're looking at.",
    "RAG search: documents indexed and searchable — maintenance manuals, floor plans, reports.",
    "Voice commands: speak to navigate, search, or ask questions hands-free.",
  ],
  // 8 — AI Asset Scan
  [
    "This is probably the most 'wow' feature — AI-powered asset detection from 360° images.",
    "The system scans NavVis panorama images and detects fire extinguishers, exit signs, etc.",
    "Each detection gets a confidence score, bounding box, and suggested Asset+ category.",
    "Approved detections are automatically registered in Asset+ with coordinates.",
    "This saves weeks of manual inventory work per building.",
  ],
  // 9 — Integrations
  [
    "Six Addnode companies connected through one platform — that's the moat.",
    "Symetri/ACC: BIM data flows in. SWG/Asset+: FM operations platform.",
    "Bimify: scan-to-BIM digitization. In Use: space utilization data.",
    "Senslinc: IoT sensors — temperature, humidity, CO₂, occupancy.",
    "Tribia/INTERAXO: construction documentation becomes operational data.",
    "Plus external APIs: Mapbox for maps, Cesium for 3D globe, Google for routing.",
  ],
  // 10 — IoT & Insights
  [
    "Heatmaps: rooms colored by temperature, occupancy, energy use — at a glance.",
    "Sensor dashboards: real-time charts with historical data from Senslinc.",
    "Predictive maintenance: AI analyzes patterns and warns before equipment fails.",
    "Alarm management: threshold-based alerts with automatic escalation.",
    "All visualized directly in the 3D model — not in a separate dashboard.",
  ],
  // 11 — Do's and Don'ts
  [
    "These are lessons learned from 3 months of intensive vibe-coding.",
    "Start small — get one thing working end-to-end before adding complexity.",
    "Iterate fast — don't plan for weeks, build something and test it today.",
    "Use the AI's strengths — UI, data fetching, state management. It's excellent at these.",
    "Don't over-architect — the AI generates simple, readable code. Trust it.",
    "Don't fight the AI — if it suggests a different approach, try it first.",
    "Test on real data early — mock data hides integration bugs.",
  ],
  // 12 — Takeaways
  [
    "Vibe-coding is real — a non-developer built a production app in 3 months.",
    "The technology is ready. The question is: what will YOU build with it?",
    "Geminus proves that Addnode's data ecosystem can be connected — today.",
    "Now let's open up for questions!",
  ],
];

/* ------------------------------------------------------------------ */
/*  Slide 1 — Title                                                    */
/* ------------------------------------------------------------------ */

const TitleSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-black/95 via-black/85 to-cyan-950/80" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-20">
      <div className="flex items-center gap-4 mb-6">
        <div className="px-5 py-2 rounded-full bg-cyan-500/40 border border-cyan-400/50 text-cyan-200 text-[22px] font-medium backdrop-blur-sm">
          Addnode Innovation 2026
        </div>
        <div className="px-5 py-2 rounded-full bg-white/10 border border-white/20 text-white/80 text-[22px] font-medium backdrop-blur-sm">
          Internal Showcase
        </div>
      </div>
      <h1 className="text-[120px] font-black leading-none tracking-tight text-white mb-4">
        GEMINUS
      </h1>
      <p className="text-[44px] font-light text-cyan-300 mb-10">
        From Idea to Production in 3 Months
      </p>
      <blockquote className="text-[28px] text-white/80 max-w-[1100px] leading-relaxed border-l-4 border-cyan-400 pl-8 italic mb-14">
        "A non-developer used vibe-coding to build a full-stack digital twin platform — solo. This is how."
      </blockquote>
      <div className="flex gap-4 flex-wrap">
        {["Pål Janson · SWG", "Built with Lovable", "Solo · 3 months", "6 API integrations", "Production-grade"].map((tag) => (
          <span key={tag} className="px-4 py-2 rounded-full bg-white/15 border border-white/30 text-[20px] text-white/90">
            {tag}
          </span>
        ))}
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 2 — The Problem I Saw                                        */
/* ------------------------------------------------------------------ */

const ProblemSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/98 via-red-950/92 to-slate-900/90" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
      <h2 className="text-[76px] font-black mb-4 text-white">The Problem I Saw</h2>
      <p className="text-[28px] text-white/70 mb-12">Buildings generate data in 10+ systems that never talk to each other</p>

      <div className="grid grid-cols-3 gap-8 mb-12">
        {[
          { icon: Building2, title: "Fragmented Data", desc: "BIM in one system, FM in another, IoT in a third — no single view", color: "text-red-400" },
          { icon: Layers, title: "Addnode Has the Pieces", desc: "6 companies with complementary products — but no connective layer", color: "text-orange-400" },
          { icon: Brain, title: "30% Time Wasted", desc: "Facility managers spend a third of their time just finding information", color: "text-yellow-400" },
        ].map(({ icon: Icon, title, desc, color }) => (
          <div key={title} className="bg-white/8 rounded-3xl p-8 border border-white/15">
            <Icon className={`w-12 h-12 ${color} mb-5`} />
            <h3 className="text-[28px] font-bold text-white mb-3">{title}</h3>
            <p className="text-[20px] text-white/70 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-cyan-500/15 rounded-2xl p-8 border border-cyan-400/40">
        <p className="text-[26px] text-white/90 leading-relaxed text-center">
          I saw this gap from the inside — 20 years across both AEC and Operations. <span className="text-cyan-300 font-bold">I decided to build the bridge.</span>
        </p>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 3 — Why Lovable / Vibe-Coding                                */
/* ------------------------------------------------------------------ */

const WhyLovableSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0E1A] via-[#0F1629] to-[#1A1040]" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
      <h2 className="text-[76px] font-black mb-4 text-white">Why Lovable?</h2>
      <p className="text-[28px] text-white/70 mb-12">Vibe-coding: describe what you want — the AI writes the code</p>

      <div className="grid grid-cols-2 gap-12 mb-10">
        {/* Traditional */}
        <div className="bg-red-500/10 rounded-3xl p-8 border border-red-400/30">
          <h3 className="text-[28px] font-bold text-red-300 mb-6 flex items-center gap-3">
            <XCircle className="w-8 h-8" /> Traditional Development
          </h3>
          <div className="space-y-4">
            {[
              "3-person dev team needed",
              "12–18 months timeline",
              "€200–400K development cost",
              "Separate front-end, back-end, DevOps",
              "Weeks of planning before any code",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-1" />
                <p className="text-[20px] text-white/80">{item}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Vibe-coding */}
        <div className="bg-emerald-500/10 rounded-3xl p-8 border border-emerald-400/30">
          <h3 className="text-[28px] font-bold text-emerald-300 mb-6 flex items-center gap-3">
            <Rocket className="w-8 h-8" /> Vibe-Coding with Lovable
          </h3>
          <div className="space-y-4">
            {[
              "Solo — one person, no team",
              "3 months to production",
              "Near-zero development cost",
              "Full-stack generated instantly",
              "Iterate at the speed of thought",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
                <p className="text-[20px] text-white/80">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-8">
        <div className="flex flex-col items-center bg-white/8 rounded-2xl px-10 py-6 border border-white/15">
          <span className="text-[56px] font-black text-red-400">12–18</span>
          <span className="text-[18px] text-white/60">months (traditional)</span>
        </div>
        <ArrowRight className="w-12 h-12 text-cyan-400" />
        <div className="flex flex-col items-center bg-cyan-500/15 rounded-2xl px-10 py-6 border border-cyan-400/40">
          <span className="text-[56px] font-black text-cyan-400">3</span>
          <span className="text-[18px] text-white/60">months (vibe-coding)</span>
        </div>
        <div className="flex flex-col items-center bg-emerald-500/10 rounded-2xl px-10 py-6 border border-emerald-400/30 ml-4">
          <span className="text-[56px] font-black text-emerald-400">75%</span>
          <span className="text-[18px] text-white/60">faster to market</span>
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 4 — My Journey — Timeline                                    */
/* ------------------------------------------------------------------ */

const TimelineSlide = () => {
  const milestones = [
    { week: "W1–2", title: "First Prototype", desc: "Viewer shell, navigation, building selector", color: "border-blue-400 bg-blue-500/20", dot: "bg-blue-400" },
    { week: "W3–4", title: "Asset+ API", desc: "Real building data flowing from FM system", color: "border-emerald-400 bg-emerald-500/20", dot: "bg-emerald-400" },
    { week: "W5–6", title: "3D Engine", desc: "xeokit integrated, IFC models in browser", color: "border-purple-400 bg-purple-500/20", dot: "bg-purple-400" },
    { week: "W7–8", title: "AI Asset Scan", desc: "Computer vision on 360° panoramas", color: "border-orange-400 bg-orange-500/20", dot: "bg-orange-400" },
    { week: "W9–10", title: "360° + Split View", desc: "Ivion SDK, virtual twin overlay", color: "border-pink-400 bg-pink-500/20", dot: "bg-pink-400" },
    { week: "W11–12", title: "Production", desc: "IoT, AI assistants, mobile, hardening", color: "border-cyan-400 bg-cyan-500/20", dot: "bg-cyan-400" },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0A0E1A] via-[#101830] to-[#0A0E1A]" />
      <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
        <h2 className="text-[76px] font-black mb-4 text-white">My Journey</h2>
        <p className="text-[28px] text-white/70 mb-14">12 weeks from zero to production — here's how it happened</p>

        <div className="relative">
          {/* Horizontal line */}
          <div className="absolute top-[44px] left-0 right-0 h-1 bg-gradient-to-r from-blue-400/50 via-purple-400/50 to-cyan-400/50 rounded-full" />

          <div className="grid grid-cols-6 gap-4">
            {milestones.map(({ week, title, desc, color, dot }) => (
              <div key={week} className="flex flex-col items-center text-center">
                {/* Week label */}
                <span className="text-[18px] font-bold text-white/60 mb-3">{week}</span>
                {/* Dot */}
                <div className={`w-6 h-6 rounded-full ${dot} shadow-lg shadow-current mb-4 ring-4 ring-black/50`} />
                {/* Card */}
                <div className={`rounded-2xl border-2 ${color} p-5 w-full mt-2`}>
                  <p className="text-[20px] font-bold text-white mb-2">{title}</p>
                  <p className="text-[16px] text-white/65 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 bg-white/8 rounded-2xl p-6 border border-white/15 text-center">
          <p className="text-[22px] text-white/80">
            Total time: <span className="text-cyan-400 font-bold">~500 hours</span> · Traditional estimate: <span className="text-red-400 font-bold">3,000–5,000 hours</span> · Speedup: <span className="text-emerald-400 font-bold">6–10×</span>
          </p>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Slide 5 — The Stack                                                */
/* ------------------------------------------------------------------ */

const StackSlide = () => {
  const layers = [
    { label: "Frontend", items: ["React 18", "Vite", "Tailwind CSS", "TypeScript"], color: "border-cyan-400/60 bg-cyan-500/15", icon: Code2, iconColor: "text-cyan-400" },
    { label: "Backend", items: ["Supabase", "PostgreSQL", "Edge Functions", "Auth + Storage"], color: "border-emerald-400/60 bg-emerald-500/15", icon: Layers, iconColor: "text-emerald-400" },
    { label: "3D / Visualization", items: ["xeokit-sdk", "NavVis IVION", "Mapbox GL", "Cesium"], color: "border-purple-400/60 bg-purple-500/15", icon: Eye, iconColor: "text-purple-400" },
    { label: "AI / ML", items: ["Gemini 2.5", "GPT-5", "RAG Search", "Vision API"], color: "border-orange-400/60 bg-orange-500/15", icon: Brain, iconColor: "text-orange-400" },
    { label: "Integrations", items: ["Asset+ API", "Senslinc IoT", "FM Access", "INTERAXO"], color: "border-pink-400/60 bg-pink-500/15", icon: Globe, iconColor: "text-pink-400" },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0A0E1A] via-[#0D1525] to-[#0A0E1A]" />
      <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
        <h2 className="text-[76px] font-black mb-4 text-white">The Stack</h2>
        <p className="text-[28px] text-white/70 mb-12">Everything generated and managed through Lovable — zero manual DevOps</p>

        <div className="grid grid-cols-5 gap-6">
          {layers.map(({ label, items, color, icon: Icon, iconColor }) => (
            <div key={label} className={`rounded-3xl border-2 ${color} p-6`}>
              <div className="flex items-center gap-3 mb-5">
                <Icon className={`w-8 h-8 ${iconColor}`} />
                <h3 className="text-[22px] font-bold text-white">{label}</h3>
              </div>
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${iconColor.replace("text-", "bg-")}`} />
                    <span className="text-[18px] text-white/80">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-center gap-6 justify-center">
          {[
            { num: "40+", label: "Edge Functions" },
            { num: "30+", label: "Database Tables" },
            { num: "200+", label: "Components" },
            { num: "50K+", label: "Lines of Code" },
          ].map(({ num, label }) => (
            <div key={label} className="flex flex-col items-center bg-white/8 rounded-2xl px-8 py-4 border border-white/15">
              <span className="text-[36px] font-black text-cyan-400">{num}</span>
              <span className="text-[16px] text-white/60">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Slide 6 — Feature: Digital Twin                                    */
/* ------------------------------------------------------------------ */

const DigitalTwinSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0E1A] via-[#0D1525] to-[#0A0E1A]" />
    <div className="relative z-10 flex h-full text-white">
      {/* Left — content */}
      <div className="w-[45%] flex flex-col justify-center px-20 py-16">
        <div className="px-4 py-2 rounded-full bg-cyan-500/30 border border-cyan-400/40 text-cyan-300 text-[18px] font-medium w-fit mb-6">
          DEMO: Digital Twin
        </div>
        <h2 className="text-[64px] font-black mb-6 text-white leading-tight">3D Digital Twin</h2>
        <div className="space-y-5">
          {[
            { icon: Building2, text: "Full BIM model in browser — IFC loaded via xeokit" },
            { icon: Layers, text: "Floor switching with real-time visibility control" },
            { icon: Eye, text: "Room visualization — color-coded by any metric" },
            { icon: Scan, text: "Split view: 3D + 360° panorama, camera synced" },
            { icon: Zap, text: "Room labels with live data — area, temp, occupancy" },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-4">
              <Icon className="w-6 h-6 text-cyan-400 shrink-0 mt-1" />
              <p className="text-[20px] text-white/80 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Right — screenshot */}
      <div className="w-[55%] flex items-center justify-center p-10">
        <div className="rounded-2xl overflow-hidden border-2 border-white/15 shadow-2xl shadow-cyan-500/20">
          <img src={screenshotViewer} alt="Digital Twin viewer" className="w-full h-auto" />
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 7 — Feature: AI Assistants                                   */
/* ------------------------------------------------------------------ */

const AiAssistantsSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0E1A] via-[#15102A] to-[#0A0E1A]" />
    <div className="relative z-10 flex h-full text-white">
      {/* Left — screenshot */}
      <div className="w-[50%] flex items-center justify-center p-10">
        <div className="rounded-2xl overflow-hidden border-2 border-white/15 shadow-2xl shadow-purple-500/20">
          <img src={screenshotGunnar} alt="AI Assistant Gunnar" className="w-full h-auto" />
        </div>
      </div>
      {/* Right — content */}
      <div className="w-[50%] flex flex-col justify-center px-16 py-16">
        <div className="px-4 py-2 rounded-full bg-purple-500/30 border border-purple-400/40 text-purple-300 text-[18px] font-medium w-fit mb-6">
          DEMO: AI Assistants
        </div>
        <h2 className="text-[60px] font-black mb-8 text-white leading-tight">AI-Powered Intelligence</h2>
        <div className="space-y-6">
          {[
            { icon: MessageSquare, title: "Gunnar — Operations AI", desc: "Ask anything about the building. Knows Asset+ data, sensors, maintenance history.", color: "text-emerald-400" },
            { icon: Brain, title: "Ilean — Contextual AI", desc: "Appears in the viewer. Knows what you're looking at. Suggests actions.", color: "text-purple-400" },
            { icon: Scan, title: "RAG Search", desc: "Documents indexed and searchable — manuals, floor plans, reports.", color: "text-orange-400" },
            { icon: Radio, title: "Voice Commands", desc: "Speak to navigate, search, or ask questions — hands-free.", color: "text-cyan-400" },
          ].map(({ icon: Icon, title, desc, color }) => (
            <div key={title} className="flex items-start gap-4">
              <Icon className={`w-7 h-7 ${color} shrink-0 mt-1`} />
              <div>
                <p className="text-[22px] font-bold text-white">{title}</p>
                <p className="text-[18px] text-white/65 leading-snug">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 8 — Feature: AI Asset Scan                                   */
/* ------------------------------------------------------------------ */

const AiScanSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0E1A] via-[#1A1005] to-[#0A0E1A]" />
    <div className="relative z-10 flex h-full text-white">
      {/* Left — content */}
      <div className="w-[45%] flex flex-col justify-center px-20 py-16">
        <div className="px-4 py-2 rounded-full bg-orange-500/30 border border-orange-400/40 text-orange-300 text-[18px] font-medium w-fit mb-6">
          DEMO: AI Asset Scan
        </div>
        <h2 className="text-[60px] font-black mb-6 text-white leading-tight">AI Inventory from 360°</h2>

        {/* Process flow */}
        <div className="space-y-4 mb-8">
          {[
            { step: "1", text: "360° panorama images from NavVis scan", color: "text-blue-400" },
            { step: "2", text: "AI vision detects objects (fire ext, signs, sensors)", color: "text-orange-400" },
            { step: "3", text: "Confidence score + category + bounding box", color: "text-yellow-400" },
            { step: "4", text: "Review queue — approve / reject / edit", color: "text-purple-400" },
            { step: "5", text: "Auto-register in Asset+ with 3D coordinates", color: "text-emerald-400" },
          ].map(({ step, text, color }) => (
            <div key={step} className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[20px] font-bold ${color}`}>
                {step}
              </div>
              <p className="text-[20px] text-white/80">{text}</p>
            </div>
          ))}
        </div>

        <div className="bg-orange-500/15 rounded-2xl p-5 border border-orange-400/30">
          <p className="text-[20px] text-white/80 text-center">
            Saves <span className="text-orange-300 font-bold">weeks of manual work</span> per building
          </p>
        </div>
      </div>
      {/* Right — screenshot */}
      <div className="w-[55%] flex items-center justify-center p-10">
        <div className="rounded-2xl overflow-hidden border-2 border-white/15 shadow-2xl shadow-orange-500/20">
          <img src={screenshotAiScan} alt="AI Asset Scan" className="w-full h-auto" />
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 9 — Feature: Integrations Hub                                */
/* ------------------------------------------------------------------ */

const IntegrationsSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/98 via-blue-950/92 to-slate-900/88" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-24 py-12">
      <div className="px-4 py-2 rounded-full bg-blue-500/30 border border-blue-400/40 text-blue-300 text-[18px] font-medium w-fit mb-4 mx-auto">
        DEMO: Integrations
      </div>
      <h2 className="text-[70px] font-black mb-10 text-white text-center">The Integration Hub</h2>

      <div className="grid grid-cols-3 gap-6 mb-10">
        {[
          { name: "Symetri / ACC", desc: "BIM & construction data", color: "border-blue-400/70 bg-blue-500/20", tc: "text-blue-300" },
          { name: "SWG / Asset+", desc: "FM operations platform", color: "border-emerald-400/70 bg-emerald-500/20", tc: "text-emerald-300" },
          { name: "Bimify", desc: "AI scan-to-BIM", color: "border-purple-400/70 bg-purple-500/20", tc: "text-purple-300" },
          { name: "In Use", desc: "Space utilization data", color: "border-violet-400/70 bg-violet-500/20", tc: "text-violet-300" },
          { name: "Senslinc", desc: "IoT real-time sensors", color: "border-orange-400/70 bg-orange-500/20", tc: "text-orange-300" },
          { name: "Tribia / INTERAXO", desc: "Construction documentation", color: "border-sky-400/70 bg-sky-500/20", tc: "text-sky-300" },
        ].map(({ name, desc, color, tc }) => (
          <div key={name} className={`flex flex-col items-center justify-center rounded-2xl border-2 ${color} px-6 py-5 text-center`}>
            <p className={`text-[24px] font-bold ${tc}`}>{name}</p>
            <p className="text-[16px] text-white/65 mt-1">{desc}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { name: "Mapbox", desc: "Interactive maps" },
          { name: "Cesium", desc: "3D globe" },
          { name: "Google Routes", desc: "Navigation" },
          { name: "Lovable AI", desc: "Gemini + GPT" },
        ].map(({ name, desc }) => (
          <div key={name} className="bg-white/8 rounded-xl px-5 py-4 border border-white/15 text-center">
            <p className="text-[20px] font-bold text-white">{name}</p>
            <p className="text-[15px] text-white/55">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 10 — Feature: IoT & Insights                                 */
/* ------------------------------------------------------------------ */

const IoTSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0E1A] via-[#0A1A15] to-[#0A0E1A]" />
    <div className="relative z-10 flex h-full text-white">
      {/* Left */}
      <div className="w-[50%] flex flex-col justify-center px-20 py-16">
        <div className="px-4 py-2 rounded-full bg-emerald-500/30 border border-emerald-400/40 text-emerald-300 text-[18px] font-medium w-fit mb-6">
          DEMO: IoT & Insights
        </div>
        <h2 className="text-[60px] font-black mb-8 text-white leading-tight">Live Building Intelligence</h2>
        <div className="space-y-6">
          {[
            { icon: Thermometer, title: "Heatmaps", desc: "Rooms colored by temperature, occupancy, or energy use", color: "text-red-400" },
            { icon: BarChart3, title: "Sensor Dashboards", desc: "Real-time + historical charts from Senslinc", color: "text-emerald-400" },
            { icon: Cpu, title: "Predictive Maintenance", desc: "AI analyzes patterns — warns before failure", color: "text-orange-400" },
            { icon: Zap, title: "Alarm Management", desc: "Threshold alerts with automatic escalation", color: "text-yellow-400" },
          ].map(({ icon: Icon, title, desc, color }) => (
            <div key={title} className="flex items-start gap-4">
              <Icon className={`w-7 h-7 ${color} shrink-0 mt-1`} />
              <div>
                <p className="text-[22px] font-bold text-white">{title}</p>
                <p className="text-[18px] text-white/65 leading-snug">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Right — screenshot */}
      <div className="w-[50%] flex items-center justify-center p-10">
        <div className="rounded-2xl overflow-hidden border-2 border-white/15 shadow-2xl shadow-emerald-500/20">
          <img src={screenshotMobile} alt="IoT Dashboard" className="w-full h-auto" />
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 11 — Do's and Don'ts                                         */
/* ------------------------------------------------------------------ */

const DosAndDontsSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0E1A] via-[#0F1629] to-[#0A0E1A]" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
      <h2 className="text-[76px] font-black mb-4 text-white text-center">Do's and Don'ts</h2>
      <p className="text-[26px] text-white/70 mb-12 text-center">Lessons from 3 months of intensive vibe-coding</p>

      <div className="grid grid-cols-2 gap-12">
        {/* Do's */}
        <div className="bg-emerald-500/8 rounded-3xl p-10 border border-emerald-400/30">
          <h3 className="text-[36px] font-black text-emerald-400 mb-8 flex items-center gap-3">
            <CheckCircle2 className="w-10 h-10" /> DO
          </h3>
          <div className="space-y-5">
            {[
              { title: "Start small", desc: "Get one feature working end-to-end before adding the next" },
              { title: "Iterate fast", desc: "Build something, test it, improve it — same day" },
              { title: "Use real data early", desc: "Mock data hides integration bugs — connect APIs from day one" },
              { title: "Trust the AI", desc: "It generates clean, readable code — don't over-engineer" },
              { title: "Write clear prompts", desc: "The better you describe what you want, the better the output" },
              { title: "Test on mobile", desc: "Many users will access on phones — design for both" },
            ].map(({ title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
                <div>
                  <span className="text-[20px] font-bold text-white">{title}</span>
                  <span className="text-[18px] text-white/60"> — {desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Don'ts */}
        <div className="bg-red-500/8 rounded-3xl p-10 border border-red-400/30">
          <h3 className="text-[36px] font-black text-red-400 mb-8 flex items-center gap-3">
            <XCircle className="w-10 h-10" /> DON'T
          </h3>
          <div className="space-y-5">
            {[
              { title: "Don't over-architect", desc: "No UML diagrams — just describe what you need, iterate" },
              { title: "Don't fight the AI", desc: "If it suggests a different approach, try it before insisting" },
              { title: "Don't skip error handling", desc: "External APIs fail — add fallbacks and loading states" },
              { title: "Don't forget context", desc: "The AI forgets between sessions — keep a plan file updated" },
              { title: "Don't hardcode secrets", desc: "Use environment variables and edge functions for API keys" },
              { title: "Don't build everything at once", desc: "Ship the MVP, then expand — avoid scope creep" },
            ].map(({ title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-1" />
                <div>
                  <span className="text-[20px] font-bold text-white">{title}</span>
                  <span className="text-[18px] text-white/60"> — {desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 12 — Key Takeaways + Q&A                                     */
/* ------------------------------------------------------------------ */

const TakeawaysSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-black/95 via-black/85 to-cyan-950/80" />
    <div className="relative z-10 flex flex-col items-center justify-center h-full text-white px-32 py-16 text-center">
      <h2 className="text-[80px] font-black mb-12 text-white">Key Takeaways</h2>

      <div className="space-y-6 mb-16 max-w-[1200px]">
        {[
          { text: "Vibe-coding is real — a non-developer built a production app in 3 months", color: "text-cyan-400" },
          { text: "Addnode's data ecosystem CAN be connected — Geminus proves it today", color: "text-emerald-400" },
          { text: "AI doesn't replace developers — it enables domain experts to build", color: "text-purple-400" },
          { text: "The technology is ready. The question is: what will YOU build?", color: "text-orange-400" },
        ].map(({ text, color }, i) => (
          <div key={i} className="flex items-center gap-5 bg-white/8 rounded-2xl px-8 py-5 border border-white/15">
            <span className={`text-[40px] font-black ${color} shrink-0`}>{i + 1}</span>
            <p className="text-[26px] text-white/90 text-left leading-snug">{text}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <HelpCircle className="w-10 h-10 text-cyan-400" />
        <p className="text-[48px] font-black text-cyan-300">Questions?</p>
      </div>
      <p className="text-[24px] text-white/50">geminus.lovable.app</p>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide registry                                                     */
/* ------------------------------------------------------------------ */

const slides = [
  TitleSlide,
  ProblemSlide,
  WhyLovableSlide,
  TimelineSlide,
  StackSlide,
  DigitalTwinSlide,
  AiAssistantsSlide,
  AiScanSlide,
  IntegrationsSlide,
  IoTSlide,
  DosAndDontsSlide,
  TakeawaysSlide,
];

/* ------------------------------------------------------------------ */
/*  Presentation shell (same engine as Presentation 1)                 */
/* ------------------------------------------------------------------ */

const SLIDE_W = 1920;
const SLIDE_H = 1080;

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function Presentation2() {
  const [current, setCurrent] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);
  const [showNotes, setShowNotes] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStarted = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fullscreen") === "1") {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const startTimer = useCallback(() => {
    if (timerStarted.current) return;
    timerStarted.current = true;
    timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const computeScale = useCallback(() => {
    setScale(Math.min(window.innerWidth / SLIDE_W, window.innerHeight / SLIDE_H));
  }, []);

  useEffect(() => {
    computeScale();
    window.addEventListener("resize", computeScale);
    return () => window.removeEventListener("resize", computeScale);
  }, [computeScale]);

  const navigate = useCallback((dir: number) => {
    startTimer();
    setCurrent((p) => Math.max(0, Math.min(p + dir, slides.length - 1)));
  }, [startTimer]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); navigate(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); navigate(-1); }
      else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else if (e.key === "n" || e.key === "N") { startTimer(); setShowNotes((v) => !v); }
      else if (e.key === "Escape" && isFullscreen) document.exitFullscreen?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen, navigate, toggleFullscreen, startTimer]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const SlideComponent = slides[current];

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black overflow-hidden select-none cursor-default" onClick={() => navigate(1)}>
      <div style={{ position: "absolute", width: SLIDE_W, height: SLIDE_H, left: "50%", top: "50%", marginLeft: -SLIDE_W / 2, marginTop: -SLIDE_H / 2, transform: `scale(${scale})`, transformOrigin: "center center" }}>
        <SlideComponent />
      </div>

      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-white/10 z-50">
        <div className="h-full bg-cyan-400 transition-all duration-300" style={{ width: `${((current + 1) / slides.length) * 100}%` }} />
      </div>

      {/* Controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-50" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => navigate(-1)} disabled={current === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white disabled:opacity-30 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-white/60 text-sm font-mono">{current + 1} / {slides.length}</span>
        <button onClick={() => navigate(1)} disabled={current === slides.length - 1} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white disabled:opacity-30 transition-colors">
          <ChevronRight className="w-5 h-5" />
        </button>
        <button onClick={toggleFullscreen} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors" title="Fullscreen (F)">
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
        <button onClick={() => { startTimer(); setShowNotes((v) => !v); }} className={`w-10 h-10 rounded-full border flex items-center justify-center text-white transition-colors ${showNotes ? "bg-cyan-500/40 border-cyan-400/60" : "bg-white/10 hover:bg-white/20 border-white/20"}`} title="Speaker Notes (N)">
          <Download className="w-4 h-4" />
        </button>
      </div>

      {/* Click zones */}
      <div className="absolute left-0 top-0 w-1/2 h-full z-40 cursor-w-resize" onClick={(e) => { e.stopPropagation(); navigate(-1); }} />
      <div className="absolute right-0 top-0 w-1/2 h-full z-40 cursor-e-resize" onClick={(e) => { e.stopPropagation(); navigate(1); }} />

      {/* Speaker Notes */}
      {showNotes && (
        <div className="absolute bottom-0 left-0 right-0 z-50 bg-black/85 backdrop-blur-md border-t border-white/20" onClick={(e) => e.stopPropagation()}>
          <div className="px-10 py-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <span className="text-white/50 text-[15px] font-semibold uppercase tracking-widest">Speaker Notes</span>
                <span className="text-white/70 text-[15px]">—</span>
                <span className="text-white text-[15px] font-medium">Slide {current + 1}: {SLIDE_TITLES[current]}</span>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Timer className="w-4 h-4" />
                  <span className="text-[18px] font-mono font-bold">{formatTime(elapsed)}</span>
                </div>
                <button onClick={() => setShowNotes(false)} className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <ul className="space-y-2">
              {NOTES[current].map((note, i) => (
                <li key={i} className="flex items-start gap-3 text-white/80 text-[16px]">
                  <span className="text-cyan-400 font-bold shrink-0 mt-0.5">•</span>
                  {note}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-white/30 text-[13px]">Press <kbd className="bg-white/10 px-2 py-0.5 rounded text-white/50">N</kbd> to toggle · <kbd className="bg-white/10 px-2 py-0.5 rounded text-white/50">←</kbd><kbd className="bg-white/10 px-2 py-0.5 rounded text-white/50">→</kbd> to navigate · <kbd className="bg-white/10 px-2 py-0.5 rounded text-white/50">F</kbd> fullscreen</p>
          </div>
        </div>
      )}
    </div>
  );
}
