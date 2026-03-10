import { useState, useEffect, useCallback, useRef } from "react";
import heroImage from "@/assets/chicago-skyline-hero.jpg";
import competitionImage from "@/assets/competition-landscape.jpg";
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
  TrendingUp,
  DollarSign,
  Clock,
  BarChart3,
  CheckCircle2,
  Target,
  Zap,
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
  "The Addnode Hub",
  "What Geminus Unlocks",
  "The Proof — It Already Works",
  "ROI — The Numbers",
  "The Competition — And Why We Win",
  "Competitive Landscape — Deep Dive",
  "Why Addnode Wins",
  "The Ask",
];

const NOTES: string[][] = [
  // Slide 1 — Title
  [
    "My name is Pål Janson — Product Solution Manager at Service Works Global.",
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
  // Slide 3 — The Addnode Hub
  [
    "Addnode already owns every ingredient needed — the question is who connects them.",
    "Symetri brings BIM and construction data, SWG brings FM operations, Bimify digitizes existing buildings.",
    "In Use brings space utilization data — real occupancy, desk booking, room usage.",
    "Senslinc brings the live heartbeat of the building — IoT sensors in real time.",
    "Geminus is the hub that makes all five more valuable than they are separately.",
  ],
  // Slide 4 — What Geminus Unlocks
  [
    "This is not about technology — it's about making each Addnode company more competitive.",
    "For Symetri: their customers stop using ACC only for construction — it becomes a lifelong tool.",
    "For SWG: Asset+ becomes the AI-powered system of record — not just a database.",
    "For Bimify: every digitization project creates a lasting digital twin, not just a one-time deliverable.",
    "For Senslinc: sensor data finally has a home — visible, contextual, actionable.",
  ],
  // Slide 5 — The Proof
  [
    "I want to be clear: this is not a PowerPoint vision — it is running in production today.",
    "A non-developer built this in 3 months using vibe-coding — which is itself the proof of concept for this competition.",
    "The AI scans 360-degree panorama images and registers assets directly into Asset+ automatically.",
    "Six API integrations across the Addnode ecosystem already exist in Geminus right now.",
    "What we are asking for is the investment to turn a working prototype into a certified product.",
  ],
  // Slide 6 — ROI
  [
    "A typical facility manager spends 30% of their time finding information.",
    "With Geminus, that drops to under 5% — a saving of roughly 200 hours per person per year.",
    "At a conservative billing rate, that is 60,000 SEK saved per FM employee per year.",
    "SWG has over 500 enterprise customers — even 10% adoption creates enormous value.",
    "Bimify scan-to-BIM combined with Geminus means no manual digitization cost.",
  ],
  // Slide 7 — Competition
  [
    "The market has real competitors — both in the Nordics and internationally.",
    "Vyer has Fastpartner, Alecta, Revelop as customers — strong visualization but zero AI layer.",
    "Digital Buildings was acquired by Newsec from Zynka — they position as Power BI for Real Estate but lack deep FM and IoT.",
    "Twinfinity spun out from Sweco in October 2022 — cloud BIM with climate data, but consulting-driven and closed ecosystem.",
    "Autodesk Tandem has a free tier and Tandem Connect/Insights modules, but US-centric with no Nordic FM integrations.",
    "None of them have AI Assistants, AI Inventory, or the full Addnode data ecosystem. That is our moat.",
  ],
  // Slide 8 — Competition Deep Dive
  [
    "This matrix shows the eight capabilities that define a modern digital twin platform.",
    "Geminus is the only solution that covers all eight — because it sits on top of Addnode's full stack.",
    "Vyer has good 3D but stops at visualization. No AI, no FM system, no IoT.",
    "Digital Buildings is analytics-focused — great dashboards but no BIM viewer, no AI, no IoT depth.",
    "Twinfinity links BIM with climate data but is consulting-heavy and has no AI capabilities.",
    "Autodesk Tandem has the global ecosystem but requires full Autodesk lock-in and has no Nordic FM integrations.",
    "The bottom line: every competitor is a point solution. Geminus is the only connective layer.",
  ],
  // Slide 9 — Why Addnode Wins
  [
    "FM software is the fastest-growing segment of the built environment — and Addnode has zero dedicated product today.",
    "Every Geminus user deepens dependency on SWG, Symetri, Bimify, Senslinc simultaneously — churn across the group drops.",
    "For the first time, SWG and Symetri can approach the same customer together — the building owner who needs both phases.",
    "Geminus turns five separate Addnode companies into one coherent value proposition.",
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
    <div className="absolute inset-0 bg-gradient-to-br from-black/95 via-black/85 to-cyan-950/80" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-20">
      <div className="flex items-center gap-4 mb-6">
        <div className="px-5 py-2 rounded-full bg-cyan-500/40 border border-cyan-400/50 text-cyan-200 text-[22px] font-medium backdrop-blur-sm">
          Addnode Innovation 2026
        </div>
      </div>
      <h1 className="text-[130px] font-black leading-none tracking-tight text-white mb-4">
        GEMINUS
      </h1>
      <p className="text-[40px] font-light text-cyan-300 mb-10">
        The AI layer that connects Addnode's ecosystem
      </p>
      <blockquote className="text-[30px] text-white/80 max-w-[1100px] leading-relaxed border-l-4 border-cyan-400 pl-8 italic mb-14">
        "I'm not a developer. I'm Pål Janson — Product Solution Manager with 20 years across AEC and O at Service Works Global. I saw the gap. I built the bridge."
      </blockquote>
      <div className="flex gap-4 flex-wrap">
        {["20 years · AEC + FM", "Service Works Global", "Built with vibe-coding", "3 months · Non-developer"].map((tag) => (
          <span key={tag} className="px-4 py-2 rounded-full bg-white/15 border border-white/30 text-[20px] text-white/90">
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
      <p className="text-[28px] text-white/80 mb-14">Addnode is strong in A, E and C — but O is underserved</p>

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
              <span className="text-[17px] text-white/75 mt-1">{sub}</span>
              {strong && <span className="mt-2 text-[16px] text-red-300 font-semibold">← THE GAP</span>}
            </div>
            {i < 3 && <ArrowRight className="w-10 h-10 text-white/30 mx-2" />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-10">
        <div className="bg-white/10 rounded-2xl p-8 border border-white/20">
          <p className="text-[26px] text-white/90 leading-relaxed">
            <span className="text-white font-bold">Symetri</span> and <span className="text-white font-bold">Service Works Global</span> now share the same business area — <span className="text-cyan-300 font-semibold">Design Management</span>.
          </p>
        </div>
        <div className="bg-red-500/15 rounded-2xl p-8 border border-red-400/50">
          <p className="text-[26px] text-white/90 leading-relaxed">
            Buildings are operated for <span className="text-red-300 font-bold">50–100 years</span>. AEC tools stop at handover. <span className="text-white font-semibold">The O in AECO is where the value lives.</span>
          </p>
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 3 — The Addnode Hub                                          */
/* ------------------------------------------------------------------ */

const HubSlide = () => {
  const companies = [
    { name: "Symetri / ACC", sub: "BIM & construction data", color: "border-blue-400/70 bg-blue-500/20", tc: "text-blue-300", pos: "top" },
    { name: "In Use", sub: "Space utilization data", color: "border-violet-400/70 bg-violet-500/20", tc: "text-violet-300", pos: "left" },
    { name: "Bimify", sub: "AI scan-to-BIM", color: "border-purple-400/70 bg-purple-500/20", tc: "text-purple-300", pos: "right" },
    { name: "SWG / Asset+", sub: "FM operations platform", color: "border-emerald-400/70 bg-emerald-500/20", tc: "text-emerald-300", pos: "bottom-left" },
    { name: "Senslinc", sub: "IoT real-time data", color: "border-orange-400/70 bg-orange-500/20", tc: "text-orange-300", pos: "bottom-right" },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden">
      <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950/97 via-blue-950/85 to-slate-900/75" />
      <div className="relative z-10 flex flex-col justify-center h-full text-white px-24 py-12">
        <h2 className="text-[70px] font-black mb-2 text-white text-center">The Addnode Hub</h2>
        <p className="text-[26px] text-white/80 mb-10 text-center">Addnode already owns every ingredient — Geminus is the missing center</p>

        {/* Hub diagram */}
        <div className="flex-1 flex items-center justify-center">
          <div className="relative" style={{ width: 1100, height: 560 }}>

            {/* Connector lines (SVG behind) */}
            <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }}>
              {/* Top — Symetri */}
              <line x1="550" y1="280" x2="550" y2="100" stroke="rgba(99,179,237,0.35)" strokeWidth="2" strokeDasharray="6 4" />
              {/* Left — In Use */}
              <line x1="550" y1="280" x2="130" y2="280" stroke="rgba(167,139,250,0.35)" strokeWidth="2" strokeDasharray="6 4" />
              {/* Right — Bimify */}
              <line x1="550" y1="280" x2="970" y2="280" stroke="rgba(192,132,252,0.35)" strokeWidth="2" strokeDasharray="6 4" />
              {/* Bottom-left — SWG */}
              <line x1="550" y1="280" x2="210" y2="470" stroke="rgba(52,211,153,0.35)" strokeWidth="2" strokeDasharray="6 4" />
              {/* Bottom-right — Senslinc */}
              <line x1="550" y1="280" x2="890" y2="470" stroke="rgba(251,146,60,0.35)" strokeWidth="2" strokeDasharray="6 4" />
            </svg>

            {/* Center — GEMINUS */}
            <div className="absolute flex flex-col items-center justify-center rounded-full border-4 border-cyan-400/80 bg-cyan-500/20 shadow-2xl shadow-cyan-500/30"
              style={{ width: 220, height: 220, left: 440, top: 170, zIndex: 10 }}>
              <Building2 className="w-12 h-12 text-cyan-400 mb-2" />
              <p className="text-[32px] font-black text-cyan-300 leading-none">GEMINUS</p>
              <p className="text-[14px] text-white/75 mt-1">Digital Twin Hub</p>
            </div>

            {/* Symetri — top center */}
            <div className="absolute flex flex-col items-center justify-center rounded-2xl border-2 border-blue-400/70 bg-blue-500/20 text-center px-5 py-4"
              style={{ width: 210, height: 100, left: 445, top: 0, zIndex: 10 }}>
              <p className="text-[20px] font-bold text-blue-300 leading-tight">Symetri / ACC</p>
              <p className="text-[14px] text-white/75 mt-1">BIM & construction data</p>
            </div>

            {/* In Use — left */}
            <div className="absolute flex flex-col items-center justify-center rounded-2xl border-2 border-violet-400/70 bg-violet-500/20 text-center px-5 py-4"
              style={{ width: 200, height: 100, left: 20, top: 230, zIndex: 10 }}>
              <p className="text-[20px] font-bold text-violet-300 leading-tight">In Use</p>
              <p className="text-[14px] text-white/75 mt-1">Space utilization data</p>
            </div>

            {/* Bimify — right */}
            <div className="absolute flex flex-col items-center justify-center rounded-2xl border-2 border-purple-400/70 bg-purple-500/20 text-center px-5 py-4"
              style={{ width: 200, height: 100, left: 880, top: 230, zIndex: 10 }}>
              <p className="text-[20px] font-bold text-purple-300 leading-tight">Bimify</p>
              <p className="text-[14px] text-white/75 mt-1">AI scan-to-BIM</p>
            </div>

            {/* SWG — bottom left */}
            <div className="absolute flex flex-col items-center justify-center rounded-2xl border-2 border-emerald-400/70 bg-emerald-500/20 text-center px-5 py-4"
              style={{ width: 220, height: 100, left: 100, top: 420, zIndex: 10 }}>
              <p className="text-[20px] font-bold text-emerald-300 leading-tight">SWG / Asset+</p>
              <p className="text-[14px] text-white/75 mt-1">FM operations platform</p>
            </div>

            {/* Senslinc — bottom right */}
            <div className="absolute flex flex-col items-center justify-center rounded-2xl border-2 border-orange-400/70 bg-orange-500/20 text-center px-5 py-4"
              style={{ width: 210, height: 100, left: 790, top: 420, zIndex: 10 }}>
              <p className="text-[20px] font-bold text-orange-300 leading-tight">Senslinc</p>
              <p className="text-[14px] text-white/75 mt-1">IoT real-time data</p>
            </div>

          </div>
        </div>

        <div className="mt-4 text-center">
          <p className="text-[24px] text-white/80 font-medium">
            All five already sit inside Addnode's <span className="text-cyan-300 font-bold">Design Management</span> business area.
            <span className="text-white font-bold"> Geminus is the missing center.</span>
          </p>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Slide 4 — What Geminus Unlocks                                     */
/* ------------------------------------------------------------------ */

const UnlocksSlide = () => {
  const rows = [
    {
      company: "Symetri",
      badge: "BIM",
      badgeColor: "bg-blue-500/20 border-blue-400/50 text-blue-300",
      value: "Their ACC/BIM data becomes useful in Operations — FM customers stay on Autodesk for life",
      arrowColor: "text-blue-400",
    },
    {
      company: "Service Works Global",
      badge: "FM",
      badgeColor: "bg-emerald-500/20 border-emerald-400/50 text-emerald-300",
      value: "Asset+ becomes the AI-powered system of record for every building — not just a database",
      arrowColor: "text-emerald-400",
    },
    {
      company: "In Use",
      badge: "Space",
      badgeColor: "bg-violet-500/20 border-violet-400/50 text-violet-300",
      value: "Space utilization data surfaces in real context — visible inside the digital twin view",
      arrowColor: "text-violet-400",
    },
    {
      company: "Bimify",
      badge: "BIM",
      badgeColor: "bg-purple-500/20 border-purple-400/50 text-purple-300",
      value: "Every building Bimify digitizes becomes a Geminus-ready digital twin — not a one-time deliverable",
      arrowColor: "text-purple-400",
    },
    {
      company: "Senslinc",
      badge: "IoT",
      badgeColor: "bg-orange-500/20 border-orange-400/50 text-orange-300",
      value: "Sensor data becomes actionable — visible in context, triggering FM workflows automatically",
      arrowColor: "text-orange-400",
    },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden">
      <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950/97 via-cyan-950/80 to-slate-900/75" />
      <div className="relative z-10 flex flex-col h-full text-white px-32 py-14">
        <h2 className="text-[68px] font-black mb-2 text-white">What Geminus Unlocks for Each Company</h2>
        <p className="text-[26px] text-white/80 mb-10">Not what Geminus takes — what each Addnode company <span className="text-cyan-300 font-semibold">gains</span></p>

        <div className="flex-1 flex flex-col justify-center space-y-5">
          {rows.map(({ company, badge, badgeColor, value, arrowColor }) => (
            <div key={company} className="flex items-center gap-8 bg-white/10 rounded-2xl border border-white/20 px-8 py-5">
              {/* Company */}
              <div className="w-[280px] shrink-0 flex items-center gap-4">
                <span className={`px-3 py-1 rounded-full border text-[15px] font-semibold ${badgeColor}`}>{badge}</span>
                <span className="text-[24px] font-bold text-white">{company}</span>
              </div>
              {/* Arrow */}
              <ArrowRight className={`w-8 h-8 shrink-0 ${arrowColor}`} />
              {/* Value */}
              <p className="text-[22px] text-white/90 leading-snug flex-1">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 bg-cyan-500/15 rounded-2xl border border-cyan-400/50 p-5 text-center">
          <p className="text-[22px] text-white font-medium">
            Every Geminus user simultaneously deepens value for <span className="text-cyan-300 font-bold">all five companies</span> — that is ecosystem lock-in through value, not contracts.
          </p>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Slide 5 — The Proof                                                */
/* ------------------------------------------------------------------ */

const ProofSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/97 via-emerald-950/80 to-slate-900/75" />
    <div className="relative z-10 flex h-full text-white px-32 py-14">

      {/* Left: Headline + stats */}
      <div className="flex-1 flex flex-col justify-center pr-16">
        <div className="flex items-center gap-4 mb-8">
          <span className="px-5 py-2 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-[20px] font-semibold">
            ✓ Running in production
          </span>
        </div>
        <h2 className="text-[80px] font-black leading-tight text-white mb-6">
          It Already<br />Works.
        </h2>
        <p className="text-[26px] text-white/80 mb-12 max-w-[700px]">
          This is not a PowerPoint vision. A non-developer built this in 3 months. The AI wrote the code.
        </p>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-6 mb-12">
          {[
            { num: "3 months", label: "start to production" },
            { num: "Non-developer", label: "no code written manually" },
            { num: "50+", label: "components built" },
            { num: "6", label: "Addnode API integrations" },
          ].map(({ num, label }) => (
            <div key={label} className="bg-white/10 rounded-2xl border border-white/20 px-6 py-4">
              <p className="text-[32px] font-black text-emerald-300 leading-none">{num}</p>
              <p className="text-[18px] text-white/80 mt-1">{label}</p>
            </div>
          ))}
        </div>

        <blockquote className="border-l-4 border-emerald-400 pl-6 text-[24px] text-white/90 italic">
          "I described what I wanted. The AI built it."
        </blockquote>
      </div>

      {/* Right: 2 screenshots */}
      <div className="w-[640px] shrink-0 flex flex-col gap-6 justify-center">
        <div className="relative rounded-2xl overflow-hidden border border-blue-400/40 h-[240px]">
          <img src={screenshotViewer} alt="3D BIM Viewer" className="w-full h-full object-cover object-top" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <p className="text-[18px] font-bold text-white">3D BIM + Live IoT Overlay</p>
            <p className="text-[14px] text-white/80">Bimify · ACC · Senslinc in one view</p>
          </div>
        </div>
        <div className="relative rounded-2xl overflow-hidden border border-emerald-400/40 h-[240px]">
          <img src={screenshotAiScan} alt="AI Asset Scan" className="w-full h-full object-cover object-top" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <p className="text-[18px] font-bold text-white">AI Scans 360° → Registers in Asset+</p>
            <p className="text-[14px] text-white/80">Gemini Vision · NavVis Ivion · SWG Asset+</p>
          </div>
        </div>
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
              <p className="text-[18px] text-white/80">FM time searching for info</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[32px] font-black text-white">30%</span>
                <ArrowRight className="w-6 h-6 text-green-400" />
                <span className="text-[32px] font-black text-green-300">&lt;5%</span>
              </div>
            </div>
            <div className="bg-green-500/20 rounded-2xl p-4">
              <p className="text-[42px] font-black text-green-300">200 h</p>
              <p className="text-[18px] text-white/80">saved per FM employee / year</p>
            </div>
            <div>
              <p className="text-[28px] font-bold text-white">60 000 SEK</p>
              <p className="text-[17px] text-white/75">≈ €5 400 per person annually</p>
            </div>
          </div>
        </div>

        {/* Col 2 — AI Inventory */}
        <div className="bg-blue-500/10 rounded-3xl border border-blue-400/40 p-8">
          <Zap className="w-10 h-10 text-blue-400 mb-4" />
          <h3 className="text-[28px] font-bold text-blue-300 mb-6">AI Inventory at Scale</h3>
          <div className="space-y-5">
            <div>
              <p className="text-[18px] text-white/80">Manual inventory per floor</p>
              <p className="text-[28px] font-bold text-white mt-1">4–6 hours</p>
            </div>
            <div>
              <p className="text-[18px] text-white/80">AI scan with Geminus</p>
              <p className="text-[28px] font-bold text-green-300 mt-1">15–30 minutes</p>
            </div>
            <div className="bg-blue-500/20 rounded-2xl p-4">
              <p className="text-[42px] font-black text-blue-300">10×</p>
              <p className="text-[18px] text-white/80">faster — at a fraction of the cost</p>
            </div>
            <p className="text-[17px] text-white/75">Bimify scan-to-BIM = no manual digitization cost</p>
          </div>
        </div>

        {/* Col 3 — Ecosystem Value */}
        <div className="bg-amber-500/10 rounded-3xl border border-amber-400/40 p-8">
          <BarChart3 className="w-10 h-10 text-amber-400 mb-4" />
          <h3 className="text-[28px] font-bold text-amber-300 mb-6">Ecosystem Value</h3>
          <div className="space-y-5">
            <div>
              <p className="text-[18px] text-white/80">SWG enterprise customers</p>
              <p className="text-[32px] font-black text-white mt-1">500+</p>
            </div>
            <div>
              <p className="text-[18px] text-white/80">At 10% Geminus adoption</p>
              <div className="bg-amber-500/20 rounded-2xl p-4 mt-1">
                <p className="text-[42px] font-black text-amber-300">50</p>
                <p className="text-[18px] text-white/80">enterprise customers</p>
              </div>
            </div>
            <p className="text-[17px] text-white/75">Cross-sell: Bimify + Senslinc per customer = significant upsell ARR</p>
          </div>
        </div>
      </div>

      {/* Bottom line */}
      <div className="bg-white/10 rounded-2xl border border-white/25 p-6 text-center">
        <p className="text-[26px] text-white font-semibold italic">
          "The $100,000 investment has the potential to unlock millions in ecosystem value."
        </p>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 7 — The Competition                                          */
/* ------------------------------------------------------------------ */

const CompetitionSlide = () => {
  const nordic = [
    { name: "Vyer", desc: "2D/3D viewer · Fastpartner, Alecta, Revelop", gap: "No AI layer, no FM system, pure visualization — no workflow" },
    { name: "Digital Buildings", desc: "Newsec/Zynka · 'Power BI for Real Estate'", gap: "No 3D BIM viewer, no AI assistants, Newsec-centric ecosystem" },
    { name: "Twinfinity", desc: "Sweco spin-off (2022) · Cloud BIM + climate data", gap: "Closed Sweco ecosystem, consulting-driven, no AI inventory" },
  ];
  const international = [
    { name: "Autodesk Tandem", desc: "Free tier · Tandem Connect + Insights modules", gap: "US-centric, requires full Autodesk stack, no Nordic FM integrations" },
    { name: "dTwin", desc: "Nemetschek digital twin platform", gap: "Large vendor lock-in, no native AI assistants" },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden">
      <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950/97 via-red-950/75 to-slate-900/80" />
      <div className="relative z-10 flex h-full text-white px-28 py-12 gap-16">

        {/* Left — competitors */}
        <div className="flex-1 flex flex-col">
          <h2 className="text-[64px] font-black text-white mb-2">The Competition</h2>
          <p className="text-[24px] text-white/80 mb-10">Who else is in this space — and what they're missing</p>

          <p className="text-[20px] font-bold text-red-300 uppercase tracking-widest mb-4">Nordic</p>
          <div className="space-y-4 mb-10">
            {nordic.map(({ name, desc, gap }) => (
              <div key={name} className="flex items-start gap-6 bg-white/10 rounded-2xl border border-white/20 px-7 py-5">
                <div className="w-[220px] shrink-0">
                  <p className="text-[22px] font-bold text-white">{name}</p>
                  <p className="text-[15px] text-white/70 mt-1">{desc}</p>
                </div>
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-red-400 text-[20px] shrink-0">✕</span>
                  <p className="text-[18px] text-white/85">{gap}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[20px] font-bold text-orange-300 uppercase tracking-widest mb-4">International</p>
          <div className="space-y-4">
            {international.map(({ name, desc, gap }) => (
              <div key={name} className="flex items-start gap-6 bg-white/10 rounded-2xl border border-white/20 px-7 py-5">
                <div className="w-[220px] shrink-0">
                  <p className="text-[22px] font-bold text-white">{name}</p>
                  <p className="text-[15px] text-white/70 mt-1">{desc}</p>
                </div>
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-orange-400 text-[20px] shrink-0">✕</span>
                  <p className="text-[18px] text-white/85">{gap}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Geminus advantage */}
        <div className="w-[540px] shrink-0 flex flex-col justify-center gap-6">
          <div className="bg-cyan-500/15 rounded-3xl border-2 border-cyan-400/70 p-8">
            <p className="text-[20px] font-bold text-cyan-300 uppercase tracking-widest mb-6">Geminus has everything they have — and more</p>
            <div className="space-y-5">
              {[
                { label: "AI Assistants (Gunnar)", sub: "Natural language FM queries — none of them have this" },
                { label: "AI Inventory", sub: "360° photo scanning → auto-registration in Asset+" },
                { label: "Full Addnode data stack", sub: "SWG + Symetri + Bimify + Senslinc + In Use" },
                { label: "Addnode's own IP", sub: "Not a licensed platform — built and owned by Addnode" },
              ].map(({ label, sub }) => (
                <div key={label} className="flex gap-4 items-start">
                  <CheckCircle2 className="w-6 h-6 text-cyan-400 mt-1 shrink-0" />
                  <div>
                    <p className="text-[20px] font-bold text-white">{label}</p>
                    <p className="text-[15px] text-white/75 mt-1">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="text-[22px] font-black text-black leading-snug">
              "Every competitor is a point solution.<br />Geminus is the connective layer<br />— and it's Addnode's own IP."
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Slide 8 — Competition Deep Dive                                    */
/* ------------------------------------------------------------------ */

const CompetitionDeepDiveSlide = () => {
  const capabilities = [
    "3D BIM Viewer",
    "AI Assistants",
    "AI Inventory",
    "IoT Integration",
    "FM System Integration",
    "Multi-vendor Data Hub",
    "Nordic Market Presence",
    "SaaS Pricing",
  ];

  type Level = "full" | "partial" | "none";

  const competitors: { name: string; color: string; scores: Level[] }[] = [
    { name: "Geminus", color: "text-cyan-300", scores: ["full", "full", "full", "full", "full", "full", "full", "full"] },
    { name: "Vyer", color: "text-white", scores: ["full", "none", "none", "none", "none", "none", "full", "full"] },
    { name: "Digital Buildings", color: "text-white", scores: ["none", "none", "none", "partial", "partial", "partial", "full", "full"] },
    { name: "Twinfinity", color: "text-white", scores: ["full", "none", "none", "partial", "partial", "none", "full", "partial"] },
    { name: "Autodesk Tandem", color: "text-white", scores: ["full", "none", "none", "full", "partial", "partial", "none", "partial"] },
  ];

  const icon = (level: Level) => {
    if (level === "full") return <span className="text-emerald-400 text-[22px]">●</span>;
    if (level === "partial") return <span className="text-amber-400 text-[22px]">◐</span>;
    return <span className="text-red-400/60 text-[22px]">○</span>;
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0a0e1a]">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0d1225] via-[#0a0e1a] to-[#080c16]" />
      <div className="relative z-10 flex flex-col h-full text-white px-28 py-12">
        <h2 className="text-[56px] font-black text-white mb-1">Competitive Landscape</h2>
        <p className="text-[22px] text-white/60 mb-6">Feature-by-feature comparison across key capabilities</p>

        {/* Legend */}
        <div className="flex items-center gap-8 mb-5">
          <div className="flex items-center gap-2"><span className="text-emerald-400 text-[20px]">✔</span><span className="text-[16px] text-white/60">Full capability</span></div>
          <div className="flex items-center gap-2"><span className="text-amber-400 text-[20px]">◐</span><span className="text-[16px] text-white/60">Partial / limited</span></div>
          <div className="flex items-center gap-2"><span className="text-red-400 text-[20px]">✘</span><span className="text-[16px] text-white/60">Not available</span></div>
        </div>

        {/* Matrix table */}
        <div className="flex-1 flex flex-col bg-white/[0.03] rounded-2xl border border-white/10 overflow-hidden">
          {/* Header row */}
          <div className="flex items-center bg-white/[0.06] px-6 py-4">
            <div className="w-[260px] shrink-0 text-[15px] font-bold text-white/40 uppercase tracking-[0.15em]">Capability</div>
            {competitors.map(({ name }) => (
              <div key={name} className={`flex-1 text-center text-[18px] font-bold ${name === "Geminus" ? "text-cyan-300 text-[20px]" : "text-white/80"}`}>
                {name}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {capabilities.map((cap, ri) => (
            <div key={cap} className={`flex items-center px-6 py-[18px] ${ri % 2 === 0 ? "" : "bg-white/[0.02]"} ${ri < capabilities.length - 1 ? "border-b border-white/[0.06]" : ""}`}>
              <div className="w-[260px] shrink-0 text-[19px] text-white font-medium">{cap}</div>
              {competitors.map(({ name, scores }) => {
                const level = scores[ri];
                return (
                  <div key={name} className={`flex-1 flex justify-center ${name === "Geminus" ? "bg-cyan-500/[0.08] rounded-lg py-1 mx-2" : ""}`}>
                    {level === "full" ? (
                      <span className="text-emerald-400 text-[24px] font-bold">✔</span>
                    ) : level === "partial" ? (
                      <span className="text-amber-400 text-[24px]">◐</span>
                    ) : (
                      <span className="text-red-400/70 text-[24px]">✘</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Bottom takeaway */}
        <div className="mt-5 bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 rounded-xl border border-cyan-400/30 px-8 py-4 text-center">
          <p className="text-[20px] font-bold text-white leading-snug">
            Geminus is the <span className="text-cyan-300">only platform</span> with full marks across all eight capabilities
          </p>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Slide 9 — Why Addnode Wins (investor language)                     */
/* ------------------------------------------------------------------ */

const WhyAddnodeSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-amber-950/75 to-slate-900/70" />
    <div className="relative z-10 flex flex-col justify-center h-full text-white px-32 py-16">
      <TrendingUp className="w-14 h-14 text-amber-400 mb-4" />
      <h2 className="text-[72px] font-black mb-4 text-white">Why Addnode Wins</h2>
      <p className="text-[26px] text-white/80 mb-14">Three strategic wins that compound across the group</p>

      <div className="grid grid-cols-3 gap-10 mb-12">
        {[
          {
            icon: DollarSign,
            title: "A new revenue layer in a €1T market",
            color: "border-amber-400/50 bg-amber-500/10",
            tc: "text-amber-300",
            points: [
              "FM software is the fastest-growing segment of the built environment",
              "Addnode has zero dedicated FM product today — this is the gap",
              "First-mover advantage in the O of AECO",
            ],
          },
          {
            icon: Target,
            title: "Ecosystem lock-in through value",
            color: "border-cyan-400/50 bg-cyan-500/10",
            tc: "text-cyan-300",
            points: [
              "Every Geminus user deepens dependency on SWG, Symetri, Bimify, Senslinc simultaneously",
              "Churn across the group drops as integrations deepen",
              "Lock-in through value, not contracts",
            ],
          },
          {
            icon: TrendingUp,
            title: "A joint go-to-market for Design Management",
            color: "border-green-400/50 bg-green-500/10",
            tc: "text-green-300",
            points: [
              "For the first time, SWG and Symetri can approach the same customer together",
              "The building owner who needs both construction-phase and operations-phase tools",
              "One coherent story for the entire Addnode Design Management business area",
            ],
          },
        ].map(({ icon: Icon, title, color, tc, points }) => (
          <div key={title} className={`rounded-3xl border-2 p-8 ${color}`}>
            <Icon className={`w-10 h-10 mb-4 ${tc}`} />
            <h3 className={`text-[24px] font-bold mb-6 leading-tight ${tc}`}>{title}</h3>
            <ul className="space-y-4">
              {points.map((p) => (
                <li key={p} className="flex gap-3 items-start text-[18px] text-white/90">
                  <CheckCircle2 className={`w-5 h-5 mt-1 shrink-0 ${tc}`} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="bg-white/10 rounded-2xl border border-white/25 p-7 text-center">
        <p className="text-[28px] text-white font-semibold italic">
          "Geminus turns five separate Addnode companies into one coherent value proposition."
        </p>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Slide 8 — The Ask                                                  */
/* ------------------------------------------------------------------ */

const AskSlide = () => (
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-black/92" />
    <div className="relative z-10 flex h-full text-white px-32 py-16">

      {/* Left — The Ask */}
      <div className="flex-1 flex flex-col justify-center pr-20">
        <DollarSign className="w-16 h-16 text-white mb-6" />
        <p className="text-[30px] text-white/80 mb-4 font-semibold uppercase tracking-widest">The Ask</p>
        <p className="text-[130px] font-black leading-none text-white mb-6">$100K</p>
        <p className="text-[28px] text-white/80 mb-12">For 6 months of productization</p>

        <div className="space-y-4 mb-12">
          {[
            "Security hardening & GDPR compliance",
            "Deep SWG Concept Evolution API integration",
            "Bimify + Senslinc live certified connectors",
          ].map((item) => (
            <div key={item} className="flex items-center gap-4">
              <CheckCircle2 className="w-6 h-6 text-white/60 shrink-0" />
              <p className="text-[24px] text-white/90">{item}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right — What Addnode gets */}
      <div className="w-[680px] shrink-0 flex flex-col justify-center">
        <div className="bg-white/5 rounded-3xl border border-white/20 p-10 mb-8">
          <h3 className="text-[26px] font-bold text-white/80 mb-6 uppercase tracking-widest">What Addnode gets</h3>
          <div className="space-y-5">
            {[
              { icon: Building2, text: "An AI Operations layer across the entire Design Management business area" },
              { icon: Zap, text: "A working demo today. A product in 6 months." },
              { icon: Target, text: "First-mover advantage in the O of AECO" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-4">
                <Icon className="w-7 h-7 text-white/70 shrink-0 mt-1" />
                <p className="text-[22px] text-white/90">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-[26px] font-black text-black leading-relaxed">
            "The code is running.<br />The integrations exist.<br />I'm ready. Are you?"
          </p>
          <p className="text-[20px] text-black/50 mt-4 font-medium">— Pål Janson, Product Solution Manager, Service Works Global</p>
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
  HubSlide,
  UnlocksSlide,
  ProofSlide,
  RoiSlide,
  CompetitionSlide,
  CompetitionDeepDiveSlide,
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
