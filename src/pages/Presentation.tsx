import { useState, useEffect, useCallback, useRef } from "react";
import heroImage from "@/assets/chicago-skyline-hero.jpg";
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
        En enhetlig plattform för att förvalta, visualisera och förstå byggnader — med 3D, 360°, AI och IoT.
      </p>
    </div>
  </div>
);

const ProblemSlide = () => (
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-16 text-red-400">Problemet</h2>
    <div className="grid grid-cols-2 gap-12">
      {[
        { icon: Database, title: "Fragmenterad data", desc: "BIM, drift, IoT, dokument — allt i olika system utan koppling." },
        { icon: AlertTriangle, title: "Bristande överblick", desc: "Ingen samlad bild av byggnadens tillstånd och tillgångar." },
        { icon: FileText, title: "Manuell inventering", desc: "Tidskrävande, felbenägen och sällan uppdaterad." },
        { icon: Globe, title: "Svår tillgänglighet", desc: "Information kräver specialverktyg och experter för att nå." },
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
    <h2 className="text-[72px] font-bold mb-6 text-cyan-400">Lösningen</h2>
    <p className="text-[28px] text-white/60 mb-16 max-w-[1200px]">
      Geminus samlar all byggnadsdata i en digital tvilling — tillgänglig för alla, överallt.
    </p>
    <div className="grid grid-cols-4 gap-10">
      {[
        { icon: Layers, label: "3D BIM", desc: "xeokit-baserad viewer med IFC-modeller" },
        { icon: Camera, label: "360° Panorama", desc: "NavVis Ivion-integration med rumsnavigering" },
        { icon: Brain, label: "AI-assistenter", desc: "Fråga Gunnar om data, Ilean om dokument" },
        { icon: Zap, label: "IoT & Sensorer", desc: "Realtidsdata från Senslinc-sensorer" },
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
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-indigo-950 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-6 text-indigo-400">3D + 360° Viewer</h2>
    <p className="text-[28px] text-white/60 mb-16">
      Utforska byggnaden i 3D-modell och 360°-panorama — sida vid sida eller som en Virtual Twin.
    </p>
    <div className="grid grid-cols-3 gap-10">
      {[
        { icon: Layers, title: "BIM-modeller", items: ["xeokit WebGL-rendering", "IFC → XKT konvertering", "Objektselektion & egenskaper", "Sektionsplan & klippning"] },
        { icon: Eye, title: "360° Integration", items: ["NavVis Ivion SDK", "Kamerasynkronisering 3D ↔ 360°", "POI-markörer med symboler", "Dataset-navigering"] },
        { icon: Building2, title: "Visningslägen", items: ["Split View — dubbla fönster", "Virtual Twin — 3D overlay på 360°", "Rumsvisualisering med färgkodning", "Arkitektläge & röntgenvy"] },
      ].map(({ icon: Icon, title, items }) => (
        <div key={title} className="bg-white/5 rounded-3xl p-8 border border-white/10">
          <div className="flex items-center gap-4 mb-6">
            <Icon className="w-10 h-10 text-indigo-400" />
            <h3 className="text-[28px] font-semibold">{title}</h3>
          </div>
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item} className="text-[22px] text-white/70 flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </div>
);

const AiDetectionSlide = () => (
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-emerald-950 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-6 text-emerald-400">AI Asset Detection</h2>
    <p className="text-[28px] text-white/60 mb-16 max-w-[1400px]">
      Automatisk inventering direkt från 360°-panoramabilder — med Google Gemini som motor.
    </p>
    <div className="flex gap-12 items-start">
      {/* Flow */}
      <div className="flex-1 space-y-8">
        {[
          { step: "1", title: "Konfigurera", desc: "Välj byggnad, detekteringsmallar och bildkälla från Ivion." },
          { step: "2", title: "Skanna", desc: "AI analyserar varje panoramabild och identifierar objekt med bounding boxes." },
          { step: "3", title: "Granska", desc: "Detektioner hamnar i en granskningskö med konfidensvärden." },
          { step: "4", title: "Registrera", desc: "Godkända detektioner skapas automatiskt som tillgångar med POI i Ivion." },
        ].map(({ step, title, desc }) => (
          <div key={step} className="flex gap-6 items-start">
            <div className="w-14 h-14 rounded-full bg-emerald-500/30 flex items-center justify-center shrink-0">
              <span className="text-[28px] font-bold text-emerald-400">{step}</span>
            </div>
            <div>
              <h3 className="text-[28px] font-semibold mb-1">{title}</h3>
              <p className="text-[22px] text-white/60 leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
      </div>
      {/* Visual */}
      <div className="w-[500px] shrink-0 bg-white/5 rounded-3xl border border-white/10 p-8 flex flex-col items-center justify-center gap-6">
        <Scan className="w-24 h-24 text-emerald-400" />
        <p className="text-[22px] text-white/50 text-center">Google Gemini Vision analyserar panoramabilder och identifierar brandskyddsutrustning, skyltar och mer.</p>
      </div>
    </div>
  </div>
);

const AiAssistantsSlide = () => (
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-purple-950 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-6 text-purple-400">AI-assistenter</h2>
    <p className="text-[28px] text-white/60 mb-16">
      Ställ frågor om byggnaden med naturligt språk — eller prata med röstkommandon.
    </p>
    <div className="grid grid-cols-3 gap-10">
      <div className="bg-white/5 rounded-3xl p-10 border border-white/10">
        <MessageSquare className="w-14 h-14 text-amber-400 mb-6" />
        <h3 className="text-[32px] font-semibold mb-4 text-amber-400">Gunnar</h3>
        <p className="text-[22px] text-white/60 leading-relaxed mb-4">Data-assistent som kan svara på frågor om tillgångar, rum, ytor och underhållsordrar.</p>
        <p className="text-[20px] text-white/40 italic">"Hur många brandsläckare finns på plan 3?"</p>
      </div>
      <div className="bg-white/5 rounded-3xl p-10 border border-white/10">
        <FileText className="w-14 h-14 text-rose-400 mb-6" />
        <h3 className="text-[32px] font-semibold mb-4 text-rose-400">Ilean</h3>
        <p className="text-[22px] text-white/60 leading-relaxed mb-4">Dokument-assistent som söker och sammanfattar ritningar, driftinstruktioner och manualer.</p>
        <p className="text-[20px] text-white/40 italic">"Visa ventilationsschemat för fläktrum B2."</p>
      </div>
      <div className="bg-white/5 rounded-3xl p-10 border border-white/10">
        <Mic className="w-14 h-14 text-cyan-400 mb-6" />
        <h3 className="text-[32px] font-semibold mb-4 text-cyan-400">Röststyrning</h3>
        <p className="text-[22px] text-white/60 leading-relaxed mb-4">Web Speech API för hands-free navigering. Styr kameran, sök objekt och ställ frågor med rösten.</p>
        <p className="text-[20px] text-white/40 italic">"Visa mig plan 2 i 3D-vyn."</p>
      </div>
    </div>
  </div>
);

const MobileSlide = () => (
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-orange-950 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-6 text-orange-400">Mobil & QR</h2>
    <p className="text-[28px] text-white/60 mb-16">
      Fullt responsiv design — med specialanpassade mobilflöden för fältarbetare.
    </p>
    <div className="grid grid-cols-3 gap-10">
      <div className="bg-white/5 rounded-3xl p-10 border border-white/10">
        <QrCode className="w-14 h-14 text-orange-400 mb-6" />
        <h3 className="text-[28px] font-semibold mb-4">QR-felanmälan</h3>
        <p className="text-[22px] text-white/60 leading-relaxed">Skanna en QR-kod på en tillgång → öppna felanmälan direkt i mobilen utan inloggning. Fota, beskriv, skicka.</p>
      </div>
      <div className="bg-white/5 rounded-3xl p-10 border border-white/10">
        <Smartphone className="w-14 h-14 text-orange-400 mb-6" />
        <h3 className="text-[28px] font-semibold mb-4">Mobil inventering</h3>
        <p className="text-[22px] text-white/60 leading-relaxed">Steg-för-steg-wizard med GPS-detektering, kategoriväljare och snabbregistrering av nya tillgångar i fält.</p>
      </div>
      <div className="bg-white/5 rounded-3xl p-10 border border-white/10">
        <Eye className="w-14 h-14 text-orange-400 mb-6" />
        <h3 className="text-[28px] font-semibold mb-4">Mobila viewers</h3>
        <p className="text-[22px] text-white/60 leading-relaxed">Fullskärms-3D och 360°-viewer optimerade för mobila enheter med touch-gester och anpassat gränssnitt.</p>
      </div>
    </div>
  </div>
);

const TechSlide = () => (
  <div className="flex flex-col justify-center h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white px-32 py-20">
    <h2 className="text-[72px] font-bold mb-6 text-cyan-400">Teknik & Arkitektur</h2>
    <p className="text-[28px] text-white/60 mb-14">
      Byggt med moderna webbteknologier och molntjänster — utan egen server.
    </p>
    <div className="grid grid-cols-2 gap-10">
      <div className="bg-white/5 rounded-3xl p-8 border border-white/10">
        <h3 className="text-[28px] font-semibold mb-6 text-cyan-400">Frontend</h3>
        <div className="space-y-4">
          {["React 18 + TypeScript", "Vite — snabb utveckling & HMR", "Tailwind CSS + shadcn/ui", "xeokit SDK — WebGL BIM-rendering", "NavVis Ivion SDK — 360° panorama", "Mapbox GL — kartvy med kluster"].map((t) => (
            <p key={t} className="text-[22px] text-white/70 flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-cyan-400" />{t}</p>
          ))}
        </div>
      </div>
      <div className="bg-white/5 rounded-3xl p-8 border border-white/10">
        <h3 className="text-[28px] font-semibold mb-6 text-cyan-400">Backend & Integrationer</h3>
        <div className="space-y-4">
          {["Lovable Cloud — databas, auth, storage", "Edge Functions — Deno-baserade serverless", "Asset+ FM API — tillgångs- & fastighetsdata", "NavVis Ivion API — POI & panoramadata", "Senslinc API — IoT-sensordata", "Google Gemini — AI vision & chat"].map((t) => (
            <p key={t} className="text-[22px] text-white/70 flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-cyan-400" />{t}</p>
          ))}
        </div>
      </div>
    </div>
    <div className="mt-10 flex items-center justify-center gap-4">
      <Server className="w-8 h-8 text-cyan-400/60" />
      <p className="text-[22px] text-white/40">Helt serverlöst — byggt och hostat på Lovable</p>
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

  // Compute scale
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

  // Keyboard nav
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

  // Fullscreen change listener
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
      {/* Scaled slide */}
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
        <div className="w-full h-full overflow-hidden rounded-sm">
          <SlideComponent />
        </div>
      </div>

      {/* Controls overlay */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-6 py-4 z-50">
        {/* Progress bar */}
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

      {/* Fullscreen toggle */}
      <button
        className="absolute top-4 left-4 z-50 text-white/30 hover:text-white/70 transition-colors"
        onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
      >
        {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
      </button>
    </div>
  );
}
