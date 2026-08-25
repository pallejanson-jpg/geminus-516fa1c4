import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

// Curated top-12 architectural IFC types with their display colors (RGB 0-1 → CSS hex).
const LEGEND_ENTRIES = [
  { label: 'Vägg',         color: [0.780, 0.773, 0.757] },
  { label: 'Fönster',      color: [0.686, 0.839, 0.902] },
  { label: 'Dörr',         color: [0.631, 0.545, 0.439] },
  { label: 'Bjälklag',     color: [0.808, 0.796, 0.773] },
  { label: 'Tak',          color: [0.596, 0.580, 0.557] },
  { label: 'Balk',         color: [0.608, 0.643, 0.690] },
  { label: 'Pelare',       color: [0.573, 0.573, 0.573] },
  { label: 'Trappa',       color: [0.757, 0.745, 0.722] },
  { label: 'Möbel',        color: [0.502, 0.573, 0.502] },
  { label: 'Takbeläggning',color: [0.863, 0.855, 0.843] },
  { label: 'Glasfasad',    color: [0.776, 0.871, 0.918] },
  { label: 'Rör (VVS)',    color: [0.65,  0.55,  0.45 ] },
  { label: 'Kanal (HVAC)', color: [0.55,  0.65,  0.72 ] },
] as const;

function toHex(r: number, g: number, b: number) {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

interface IfcColorLegendProps {
  className?: string;
}

const IfcColorLegend: React.FC<IfcColorLegendProps> = ({ className }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('absolute top-14 right-3 z-20', className)}>
      <div className="bg-black/75 backdrop-blur-sm rounded-lg border border-white/10 text-white text-xs overflow-hidden shadow-lg">
        <button
          onClick={() => setOpen(p => !p)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 w-full hover:bg-white/10 transition-colors"
          aria-expanded={open}
        >
          <Layers className="h-3 w-3 opacity-70" />
          <span className="font-medium">IFC-legend</span>
          {open ? <ChevronUp className="h-3 w-3 ml-auto opacity-60" /> : <ChevronDown className="h-3 w-3 ml-auto opacity-60" />}
        </button>
        {open && (
          <div className="px-2.5 pb-2 space-y-0.5">
            {LEGEND_ENTRIES.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-4 rounded-sm shrink-0 border border-white/10"
                  style={{ backgroundColor: toHex(color[0], color[1], color[2]) }}
                />
                <span className="opacity-85">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default IfcColorLegend;
