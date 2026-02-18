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
  Network,
  Link2,
  TrendingUp,
  DollarSign,
  Code2,
  Users,
  Clock,
  BarChart3,
  CheckCircle2,
  Sparkles,
  Target,
  Zap,
  Brain,
  ArrowRight,
  X,
  Timer,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Speaker Notes Data                                                 */
/* ------------------------------------------------------------------ */

const SLIDE_TITLES = [
  "Title — I'm Pål. I connected the dots.",
  "The AECO Gap",
  "The Addnode Ecosystem",
  "Geminus — The Bridge",
  "AI That Works Today",
  "ROI — The Numbers",
  "Built With Vibe-Coding",
  "Why Addnode Wins",
  "The Ask",
];

const NOTES: string[][] = [
  // Slide 1 — Title
  [
    "My name is Pål Janson — Product Solution Manager at Symetri.",
    "20 years of experience across both AEC and O within the AECO industry.",
    "I'm not a developer — I'm a problem-solver who used AI to build a solution.",
    "3 months ago I had an idea. Today it's running in production.",
    "This is Geminus.",
  ],
  // Slide 2 — AECO Gap
  [
    "The AECO industry covers Architecture, Engineering, Construction and Operations.",
    "Addnode is strong in A, E and C — through Symetri and its brands.",
    "But O — Operations and Facility Management — is where buildings live for 50 to 100 years.",
    "Symetri and Service Works Global now share the Design Management business area.",
    "This is the moment to close the gap and serve the full lifecycle.",
  ],
  // Slide 3 — Ecosystem
  [
    "Addnode already owns the ingredients: SWG, Symetri/ACC, Bimify, Senslinc.",
    "Bimify digitizes existing buildings with AI — turning photos into BIM models.",
    "Senslinc provides real-time IoT data — temperature, CO2, occupancy.",
    "None of these talk to each other today.",
    "Geminus connects them — using APIs that already exist.",
  ],
  // Slide 4 — The Bridge
  [
    "Geminus sits in the middle of the Addnode ecosystem.",
    "It pulls BIM from Bimify and ACC, operations data from SWG, sensor data from Senslinc.",
    "No migration needed — we build on top of existing systems.",
    "One interface for the facility manager who doesn't care which system the data comes from.",
    "This is the connective tissue Addnode needs.",
  ],
  // Slide 5 — AI That Works Today
  [
    "This is not a prototype or a mockup — it is running in production.",
    "AI scans 360-degree panorama images and registers fire safety assets automatically.",
    "Gunnar answers questions about assets in natural language.",
    "Mobile camera lets field workers photograph an object — Gemini Vision identifies it instantly.",
    "All assets land directly in Asset+ — the SWG system our customers already use.",
  ],
  // Slide 6 — ROI
  [
    "A typical facility manager spends 30% of their time finding information.",
    "With Geminus, that drops to under 5% — a saving of roughly 200 hours per person per year.",
    "At a conservative billing rate, that is 60,000 SEK saved per FM employee per year.",
    "SWG has over 500 enterprise customers — even 10% adoption creates enormous value.",
    "Bimify scan-to-BIM combined with Geminus means no manual digitization cost.",
  ],
  // Slide 7 — Vibe-Coding
  [
    "I built this without writing a single line of code manually.",
    "I described what I wanted in plain English — the AI wrote the code.",
    "50+ React components, 15+ serverless backend functions, 6 external API integrations.",
    "3 months of evenings and weekends.",
    "This competition is about AI plus vibe-coding — and this IS the proof of what that looks like.",
  ],
  // Slide 8 — Why Addnode Wins
  [
    "Every Geminus user is locked deeper into the Addnode ecosystem.",
    "Bimify upsell: does your building have a BIM model yet? Now it can.",
    "Senslinc upsell: do you have real-time sensor data? Add it to your digital twin.",
    "SWG and Symetri can go to market together for the first time with a joint value proposition.",
    "The O in AECO is a blue ocean — and Addnode already has all the assets to win it.",
  ],
  // Slide 9 — The Ask
  [
    "One hundred thousand dollars to productize what is already working.",
    "Security hardening, GDPR compliance, deep SWG Concept Evolution API integration.",
    "Bimify and Senslinc live connectors with certified support agreements.",
    "Six months. A product. A competitive moat across the Design Management business area.",
    "The code is running. The integrations exist. I'm ready. Are you?",
  ],
];

/* ------------------------------------------------------------------ */
/*  Slide 1 — Title                                                    */
/* ------------------------------------------------------------------ */

const TitleSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-black/90 via-black/70 to-cyan-950/60" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-20">
      <div className="flex items-center gap-4 mb-6">
        <div className="px-5 py-2 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 text-[22px] font-medium">
          Addnode Innovation 2025
        </div>
      </div>
      <h1 className="text-[130px] font-black leading-none tracking-tight text-white mb-4">
        GEMINUS
      </h1>
      <p className="text-[40px] font-light text-cyan-300 mb-10">
        The AI layer that connects Addnode's ecosystem
      </p>
      <blockquote className="text-[30px] text-white/80 max-w-[1100px] leading-relaxed border-l-4 border-cyan-400 pl-8 italic mb-14">
        "I'm not a developer. I'm Pål Janson — Product Solution Manager with 20 years across AEC and O at Symetri. I saw the gap. I built the bridge."
      </blockquote>
      <div className="flex gap-4 flex-wrap">
        {["20 years · AEC + FM", "Symetri · Service Works Global", "Built with vibe-coding", "3 months · Non-developer"].map((tag) => (
          <span key={tag} className="px-4 py-2 rounded-full bg-white/10 border border-white/20 text-[20px] text-white/70">
            {tag}
          </span>
        ))}
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 2 — AECO Gap                                                 */
/* ------------------------------------------------------------------ */

const AecoGapSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-red-950/80 to-orange-950/60" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
      <h2 className="text-[80px] font-black mb-4 text-white">The AECO Industry Has a Gap</h2>
      <p className="text-[28px] text-white/60 mb-14">Addnode is strong in A, E and C — but O is underserved</p>

      {/* AECO pipeline */}
      <div className="flex items-center gap-0 mb-14">
        {[
          { letter: "A", label: "Architecture", sub: "CAD / BIM Design", color: "bg-blue-500/30 border-blue-400", text: "text-blue-300", strong: false },
          { letter: "E", label: "Engineering", sub: "Calculation / BIM", color: "bg-blue-500/30 border-blue-400", text: "text-blue-300", strong: false },
          { letter: "C", label: "Construction", sub: "Project Mgmt / ACC", color: "bg-blue-500/30 border-blue-400", text: "text-blue-300", strong: false },
          { letter: "O", label: "Operations", sub: "FM / Asset Mgmt", color: "bg-red-500/40 border-red-400", text: "text-red-300", strong: true },
        ].map(({ letter, label, sub, color, text, strong }, i) => (
          <div key={letter} className="flex items-center">
            <div className={`flex flex-col items-center justify-center w-[290px] h-[200px] rounded-3xl border-2 ${color} ${strong ? "scale-110 shadow-2xl shadow-red-500/30" : ""}`}>
              <span className={`text-[90px] font-black leading-none ${text}`}>{letter}</span>
              <span className="text-[22px] font-semibold text-white mt-1">{label}</span>
              <span className="text-[17px] text-white/50 mt-1">{sub}</span>
              {strong && <span className="mt-2 text-[16px] text-red-300 font-semibold">← THE GAP</span>}
            </div>
            {i < 3 && <ArrowRight className="w-10 h-10 text-white/30 mx-2" />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-10">
        <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
          <p className="text-[26px] text-white/80 leading-relaxed">
            <span className="text-white font-bold">Symetri</span> and <span className="text-white font-bold">Service Works Global</span> now share the same business area — <span className="text-cyan-300 font-semibold">Design Management</span>.
          </p>
        </div>
        <div className="bg-red-500/10 rounded-2xl p-8 border border-red-400/30">
          <p className="text-[26px] text-white/80 leading-relaxed">
            Buildings are operated for <span className="text-red-300 font-bold">50–100 years</span>. AEC tools stop at handover. <span className="text-white font-semibold">The O in AECO is where the value lives.</span>
          </p>
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 3 — Addnode Ecosystem                                        */
/* ------------------------------------------------------------------ */

const EcosystemSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-blue-950/80 to-slate-900/70" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
      <h2 className="text-[72px] font-black mb-4 text-white">The Ingredients Are Already Inside Addnode</h2>
      <p className="text-[28px] text-white/60 mb-14">Four companies. Four data sources. Zero connections.</p>

      <div className="grid grid-cols-4 gap-8 mb-12">
        {[
          { name: "Symetri / ACC", role: "BIM for new construction", detail: "Autodesk Construction Cloud — project data, BIM models, documents", color: "bg-blue-500/20 border-blue-400/50", icon: "🏗️" },
          { name: "Service Works Global", role: "FM Platform & Asset+", detail: "Concept Evolution, Asset+, work orders — the O in AECO", color: "bg-emerald-500/20 border-emerald-400/50", icon: "🏢" },
          { name: "Bimify", role: "AI Scan-to-BIM", detail: "Digitizes existing buildings with AI — photos become BIM models", color: "bg-purple-500/20 border-purple-400/50", icon: "🤖" },
          { name: "Senslinc", role: "IoT & Real-time Data", detail: "Temperature, CO₂, occupancy, energy — live sensor streams", color: "bg-orange-500/20 border-orange-400/50", icon: "📡" },
        ].map(({ name, role, detail, color, icon }) => (
          <div key={name} className={`rounded-2xl border p-6 ${color} flex flex-col`}>
            <div className="text-[48px] mb-3">{icon}</div>
            <h3 className="text-[24px] font-bold text-white mb-1">{name}</h3>
            <p className="text-[18px] text-white/70 font-semibold mb-3">{role}</p>
            <p className="text-[16px] text-white/50 leading-relaxed">{detail}</p>
          </div>
        ))}
      </div>

      <div className="bg-white/5 rounded-2xl p-8 border border-white/10 text-center">
        <p className="text-[30px] text-white font-semibold">
          All four companies now co-exist in the <span className="text-cyan-300">Design Management</span> business area.
        </p>
        <p className="text-[24px] text-white/60 mt-3">
          But they don't talk to each other. <span className="text-white font-bold">Until now.</span>
        </p>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 4 — The Bridge                                               */
/* ------------------------------------------------------------------ */

const BridgeSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-cyan-950/75 to-slate-900/70" />
    <div className="relative z-10 flex h-full text-white px-32 py-16">

      {/* Left: Content */}
      <div className="flex-1 flex flex-col justify-center pr-16">
        <h2 className="text-[72px] font-black mb-4 text-cyan-300">Geminus: The Connective Tissue</h2>
        <p className="text-[26px] text-white/60 mb-12">
          One platform. All your building data. Powered by AI.
        </p>
        <div className="space-y-6">
          {[
            { icon: Network, title: "No migration needed", desc: "Builds on top of existing APIs — SWG Asset+, ACC, Bimify, Senslinc" },
            { icon: Link2, title: "One source of truth", desc: "BIM, FM-data, sensors and 360° panoramas in one unified interface" },
            { icon: Brain, title: "AI on top", desc: "Gemini Vision for inventory, Gunnar for FM queries, voice control" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-5 items-start">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shrink-0">
                <Icon className="w-7 h-7 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-[26px] font-bold text-white">{title}</h3>
                <p className="text-[20px] text-white/60">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Integration diagram */}
      <div className="w-[680px] shrink-0 flex flex-col items-center justify-center">
        <div className="relative w-full">
          {/* Surrounding nodes */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            {[
              { label: "Bimify", sub: "AI → BIM", color: "border-purple-400/60 bg-purple-500/20", tc: "text-purple-300" },
              { label: "Symetri / ACC", sub: "BIM Models", color: "border-blue-400/60 bg-blue-500/20", tc: "text-blue-300" },
              { label: "SWG Asset+", sub: "FM Operations", color: "border-emerald-400/60 bg-emerald-500/20", tc: "text-emerald-300" },
              { label: "Senslinc", sub: "IoT Real-time", color: "border-orange-400/60 bg-orange-500/20", tc: "text-orange-300" },
            ].map(({ label, sub, color, tc }) => (
              <div key={label} className={`rounded-2xl border-2 p-5 ${color} text-center`}>
                <p className={`text-[22px] font-bold ${tc}`}>{label}</p>
                <p className="text-[16px] text-white/50">{sub}</p>
              </div>
            ))}
          </div>
          {/* Arrows */}
          <div className="flex justify-center mb-6">
            <div className="flex gap-8 text-white/40 text-[32px]">
              <span>↓</span><span>↓</span><span>↓</span><span>↓</span>
            </div>
          </div>
          {/* Geminus center */}
          <div className="rounded-3xl border-2 border-cyan-400/80 bg-cyan-500/20 p-8 text-center shadow-2xl shadow-cyan-500/20">
            <Building2 className="w-16 h-16 text-cyan-400 mx-auto mb-3" />
            <p className="text-[40px] font-black text-cyan-300">GEMINUS</p>
            <p className="text-[20px] text-white/60 mt-2">Digital Twin Platform</p>
          </div>
          {/* Arrow down */}
          <div className="flex justify-center mt-6 mb-6">
            <span className="text-white/40 text-[32px]">↓</span>
          </div>
          {/* FM User */}
          <div className="rounded-2xl border border-white/20 bg-white/5 p-5 text-center">
            <Users className="w-8 h-8 text-white/60 mx-auto mb-2" />
            <p className="text-[20px] text-white/70">Facility Manager — one interface</p>
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 5 — AI That Works Today                                      */
/* ------------------------------------------------------------------ */

const DemoSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-emerald-950/75 to-slate-900/70" />
    <div className="relative z-10 flex flex-col h-full text-white px-32 py-14">
      <div className="mb-8">
        <h2 className="text-[68px] font-black text-white">This Is Not a Prototype.</h2>
        <p className="text-[32px] text-emerald-400 font-semibold">It's Running in Production.</p>
      </div>

      <div className="grid grid-cols-2 gap-8 flex-1">
        {[
          { img: screenshotViewer, label: "3D BIM + 360° Panorama", sub: "BIM from Bimify/ACC · NavVis Ivion · Senslinc IoT overlay", color: "border-blue-400/40" },
          { img: screenshotAiScan, label: "AI Asset Detection", sub: "Gemini Vision scans 360° images → registers assets in Asset+", color: "border-emerald-400/40" },
          { img: screenshotGunnar, label: "Gunnar — AI Assistant", sub: `"How many fire extinguishers on floor 3?" — answered instantly`, color: "border-purple-400/40" },
          { img: screenshotMobile, label: "Mobile Camera → AI → Asset+", sub: "Field workers photograph an object — Gemini identifies it instantly", color: "border-orange-400/40" },
        ].map(({ img, label, sub, color }) => (
          <div key={label} className={`relative rounded-2xl overflow-hidden border ${color} group`}>
            <img src={img} alt={label} className="w-full h-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <p className="text-[22px] font-bold text-white">{label}</p>
              <p className="text-[16px] text-white/60">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 text-center">
        <span className="px-6 py-3 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-[20px] font-semibold">
          Integrated with: Asset+ · Ivion · Senslinc · Autodesk ACC · Bimify BIM
        </span>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 6 — ROI                                                      */
/* ------------------------------------------------------------------ */

const RoiSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-green-950/80 to-slate-900/70" />
    <div className="relative z-10 flex flex-col h-full text-white px-32 py-14">
      <div className="mb-10">
        <h2 className="text-[72px] font-black text-white">ROI — The Numbers</h2>
        <p className="text-[28px] text-green-400">What does Geminus actually deliver?</p>
      </div>

      <div className="grid grid-cols-3 gap-10 mb-10">
        {/* Col 1 — FM Efficiency */}
        <div className="bg-green-500/10 rounded-3xl border border-green-400/40 p-8">
          <Clock className="w-10 h-10 text-green-400 mb-4" />
          <h3 className="text-[28px] font-bold text-green-300 mb-6">FM Efficiency</h3>
          <div className="space-y-5">
            <div>
              <p className="text-[18px] text-white/60">FM time searching for info</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[32px] font-black text-white">30%</span>
                <ArrowRight className="w-6 h-6 text-green-400" />
                <span className="text-[32px] font-black text-green-300">&lt;5%</span>
              </div>
            </div>
            <div className="bg-green-500/20 rounded-2xl p-4">
              <p className="text-[42px] font-black text-green-300">200 h</p>
              <p className="text-[18px] text-white/70">saved per FM employee / year</p>
            </div>
            <div>
              <p className="text-[28px] font-bold text-white">60 000 SEK</p>
              <p className="text-[17px] text-white/50">≈ €5 400 per person annually</p>
            </div>
          </div>
        </div>

        {/* Col 2 — AI Inventory */}
        <div className="bg-blue-500/10 rounded-3xl border border-blue-400/40 p-8">
          <Zap className="w-10 h-10 text-blue-400 mb-4" />
          <h3 className="text-[28px] font-bold text-blue-300 mb-6">AI Inventory at Scale</h3>
          <div className="space-y-5">
            <div>
              <p className="text-[18px] text-white/60">Manual inventory per floor</p>
              <p className="text-[28px] font-bold text-white mt-1">4–6 hours</p>
            </div>
            <div>
              <p className="text-[18px] text-white/60">AI scan with Geminus</p>
              <p className="text-[28px] font-bold text-green-300 mt-1">15–30 minutes</p>
            </div>
            <div className="bg-blue-500/20 rounded-2xl p-4">
              <p className="text-[42px] font-black text-blue-300">10×</p>
              <p className="text-[18px] text-white/70">faster — at a fraction of the cost</p>
            </div>
            <p className="text-[17px] text-white/50">Bimify scan-to-BIM = no manual digitization cost</p>
          </div>
        </div>

        {/* Col 3 — Ecosystem Value */}
        <div className="bg-amber-500/10 rounded-3xl border border-amber-400/40 p-8">
          <BarChart3 className="w-10 h-10 text-amber-400 mb-4" />
          <h3 className="text-[28px] font-bold text-amber-300 mb-6">Ecosystem Value</h3>
          <div className="space-y-5">
            <div>
              <p className="text-[18px] text-white/60">SWG enterprise customers</p>
              <p className="text-[32px] font-black text-white mt-1">500+</p>
            </div>
            <div>
              <p className="text-[18px] text-white/60">At 10% Geminus adoption</p>
              <div className="bg-amber-500/20 rounded-2xl p-4 mt-1">
                <p className="text-[42px] font-black text-amber-300">50</p>
                <p className="text-[18px] text-white/70">enterprise customers</p>
              </div>
            </div>
            <p className="text-[17px] text-white/50">Cross-sell: Bimify + Senslinc per customer = significant upsell ARR</p>
          </div>
        </div>
      </div>

      {/* Bottom line */}
      <div className="bg-white/5 rounded-2xl border border-white/15 p-6 text-center">
        <p className="text-[26px] text-white font-semibold italic">
          "The $100,000 investment has the potential to unlock millions in ecosystem value."
        </p>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 7 — Vibe-Coding                                              */
/* ------------------------------------------------------------------ */

const VibeCodingSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/98 via-purple-950/85 to-slate-900/70" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-20">
      <div className="flex items-center gap-5 mb-6">
        <Code2 className="w-14 h-14 text-purple-400" />
        <div className="px-5 py-2 rounded-full bg-purple-500/20 border border-purple-400/40 text-purple-300 text-[22px] font-medium">
          Vibe-Coding in action
        </div>
      </div>
      <h2 className="text-[90px] font-black leading-tight text-white mb-4">
        3 months.<br />No coding experience.<br /><span className="text-purple-400">$0 dev cost.</span>
      </h2>
      <p className="text-[28px] text-white/60 mb-14 max-w-[1100px]">
        This is vibe-coding — and this is what it can produce.
      </p>

      <div className="grid grid-cols-3 gap-10 mb-14">
        {[
          { num: "50+", label: "React components", icon: Sparkles },
          { num: "15+", label: "Serverless backend functions", icon: Zap },
          { num: "6", label: "External API integrations", icon: Link2 },
        ].map(({ num, label, icon: Icon }) => (
          <div key={label} className="bg-purple-500/10 rounded-2xl border border-purple-400/30 p-8 flex flex-col items-center text-center">
            <Icon className="w-10 h-10 text-purple-400 mb-4" />
            <p className="text-[64px] font-black text-purple-300 leading-none mb-2">{num}</p>
            <p className="text-[22px] text-white/70">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white/5 rounded-2xl border border-white/10 p-8">
        <blockquote className="text-[28px] text-white/80 italic">
          "I described what I wanted in plain English. The AI wrote the code. I shaped the product."
        </blockquote>
        <p className="text-[22px] text-purple-300 mt-4 font-semibold">
          This competition is about AI + vibe-coding. This IS the proof.
        </p>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 8 — Why Addnode Wins                                         */
/* ------------------------------------------------------------------ */

const WhyAddnodeSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-amber-950/75 to-slate-900/70" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
      <TrendingUp className="w-14 h-14 text-amber-400 mb-4" />
      <h2 className="text-[72px] font-black mb-4 text-white">Three Strategic Wins for Addnode</h2>
      <p className="text-[26px] text-white/60 mb-14">Every Geminus user is locked deeper into the ecosystem</p>

      <div className="grid grid-cols-3 gap-10 mb-12">
        {[
          {
            icon: Target,
            title: "Ecosystem Stickiness",
            color: "border-amber-400/50 bg-amber-500/10",
            tc: "text-amber-300",
            points: [
              "SWG + Symetri customers who use Geminus stay inside Addnode",
              "More integrations = harder to leave",
              "Lock-in through value, not contracts",
            ],
          },
          {
            icon: TrendingUp,
            title: "Cross-Sell Engine",
            color: "border-cyan-400/50 bg-cyan-500/10",
            tc: "text-cyan-300",
            points: [
              "Bimify upsell: no BIM model? Now you can have one",
              "Senslinc upsell: add real-time IoT to your digital twin",
              "Symetri sells ACC → Geminus visualizes it",
            ],
          },
          {
            icon: DollarSign,
            title: "Blue Ocean Revenue",
            color: "border-green-400/50 bg-green-500/10",
            tc: "text-green-300",
            points: [
              "O in AECO is unserved by any Addnode product today",
              "SWG + Symetri go to market together for the first time",
              "New AI layer on top of existing licenses",
            ],
          },
        ].map(({ icon: Icon, title, color, tc, points }) => (
          <div key={title} className={`rounded-3xl border-2 p-8 ${color}`}>
            <Icon className={`w-10 h-10 mb-4 ${tc}`} />
            <h3 className={`text-[28px] font-bold mb-6 ${tc}`}>{title}</h3>
            <ul className="space-y-4">
              {points.map((p) => (
                <li key={p} className="flex gap-3 items-start text-[19px] text-white/75">
                  <CheckCircle2 className={`w-5 h-5 mt-1 shrink-0 ${tc}`} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="bg-white/5 rounded-2xl border border-white/15 p-7 text-center">
        <p className="text-[28px] text-white font-semibold italic">
          "The $100K doesn't fund a product. It funds a competitive moat across the Design Management business area."
        </p>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 9 — The Ask                                                  */
/* ------------------------------------------------------------------ */

const AskSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-black/92" />
    <div className="relative z-10 flex h-full text-white px-32 py-16">

      {/* Left — The Ask */}
      <div className="flex-1 flex flex-col justify-center pr-20">
        <DollarSign className="w-16 h-16 text-white mb-6" />
        <p className="text-[30px] text-white/60 mb-4 font-semibold uppercase tracking-widest">The Ask</p>
        <p className="text-[130px] font-black leading-none text-white mb-6">$100K</p>
        <p className="text-[28px] text-white/60 mb-12">For 6 months of productization</p>

        <div className="space-y-4 mb-12">
          {[
            "Security hardening & GDPR compliance",
            "Deep SWG Concept Evolution API integration",
            "Bimify + Senslinc live certified connectors",
          ].map((item) => (
            <div key={item} className="flex items-center gap-4">
              <CheckCircle2 className="w-6 h-6 text-white/60 shrink-0" />
              <p className="text-[24px] text-white/80">{item}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right — What Addnode gets */}
      <div className="w-[680px] shrink-0 flex flex-col justify-center">
        <div className="bg-white/5 rounded-3xl border border-white/20 p-10 mb-8">
          <h3 className="text-[26px] font-bold text-white/60 mb-6 uppercase tracking-widest">What Addnode gets</h3>
          <div className="space-y-5">
            {[
              { icon: Building2, text: "An AI Operations layer across the entire Design Management business area" },
              { icon: Zap, text: "A working demo today. A product in 6 months." },
              { icon: Target, text: "First-mover advantage in the O of AECO" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-4">
                <Icon className="w-7 h-7 text-white/50 shrink-0 mt-1" />
                <p className="text-[22px] text-white/80">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-[26px] font-black text-black leading-relaxed">
            "The code is running.<br />The integrations exist.<br />I'm ready. Are you?"
          </p>
          <p className="text-[20px] text-black/50 mt-4 font-medium">— Pål Janson, Product Solution Manager, Symetri</p>
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide registry                                                     */
/* ------------------------------------------------------------------ */

const slides = [
  TitleSlide,
  AecoGapSlide,
  EcosystemSlide,
  BridgeSlide,
  DemoSlide,
  RoiSlide,
  VibeCodingSlide,
  WhyAddnodeSlide,
  AskSlide,
];

/* ------------------------------------------------------------------ */
/*  Presentation shell                                                 */
/* ------------------------------------------------------------------ */

const SLIDE_W = 1920;
const SLIDE_H = 1080;

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function Presentation() {
  const [current, setCurrent] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);
  const [showNotes, setShowNotes] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStarted = useRef(false);

  // Auto-enter fullscreen if ?fullscreen=1 is in the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fullscreen") === "1") {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const startTimer = useCallback(() => {
    if (timerStarted.current) return;
    timerStarted.current = true;
    timerRef.current = setInterval(() => {
      setElapsed((p) => p + 1);
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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

  const navigate = useCallback((dir: number) => {
    startTimer();
    setCurrent((p) => Math.max(0, Math.min(p + dir, slides.length - 1)));
  }, [startTimer]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        navigate(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "n" || e.key === "N") {
        startTimer();
        setShowNotes((v) => !v);
      } else if (e.key === "Escape" && isFullscreen) {
        document.exitFullscreen?.();
      }
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
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black overflow-hidden select-none cursor-default"
      onClick={() => navigate(1)}
    >
      {/* Scaled slide */}
      <div
        style={{
          position: "absolute",
          width: SLIDE_W,
          height: SLIDE_H,
          left: "50%",
          top: "50%",
          marginLeft: -SLIDE_W / 2,
          marginTop: -SLIDE_H / 2,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <SlideComponent />
      </div>

      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-white/10 z-50">
        <div
          className="h-full bg-cyan-400 transition-all duration-300"
          style={{ width: `${((current + 1) / slides.length) * 100}%` }}
        />
      </div>

      {/* Controls */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => navigate(-1)}
          disabled={current === 0}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-white/60 text-sm font-mono">
          {current + 1} / {slides.length}
        </span>
        <button
          onClick={() => navigate(1)}
          disabled={current === slides.length - 1}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <button
          onClick={toggleFullscreen}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors"
          title="Fullscreen (F)"
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
        <button
          onClick={() => { startTimer(); setShowNotes((v) => !v); }}
          className={`w-10 h-10 rounded-full border flex items-center justify-center text-white transition-colors ${showNotes ? "bg-cyan-500/40 border-cyan-400/60" : "bg-white/10 hover:bg-white/20 border-white/20"}`}
          title="Speaker Notes (N)"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>

      {/* Left / right click zones */}
      <div
        className="absolute left-0 top-0 w-1/2 h-full z-40 cursor-w-resize"
        onClick={(e) => { e.stopPropagation(); navigate(-1); }}
      />
      <div
        className="absolute right-0 top-0 w-1/2 h-full z-40 cursor-e-resize"
        onClick={(e) => { e.stopPropagation(); navigate(1); }}
      />

      {/* Speaker Notes Panel */}
      {showNotes && (
        <div
          className="absolute bottom-0 left-0 right-0 z-50 bg-black/85 backdrop-blur-md border-t border-white/20"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-10 py-6">
            {/* Header */}
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
                <button
                  onClick={() => setShowNotes(false)}
                  className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Notes bullets */}
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
