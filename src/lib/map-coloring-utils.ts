export type MapColoringMode = 
  | 'none' 
  | 'energy-efficiency' 
  | 'work-orders' 
  | 'co2' 
  | 'energy-rating';

export type EnergyRating = 'A' | 'B' | 'C' | 'D' | 'E';

export interface BuildingMetrics {
  fmGuid: string;
  energyPerSqm: number;
  workOrders: number;
  co2Tons: number;
  energyRating: EnergyRating;
}

// Color scales — synchronized with Nordic Pro chart palette
const COLORS = {
  green: '#38A88C',     // chart-3 positive/teal
  lightGreen: '#408F5E', // chart-8 success/dark green
  yellow: '#D4913B',    // chart-4 warning/amber
  orange: '#C94F6D',    // chart-5 negative/rose
  red: '#dc2626',       // destructive
  darkGreen: '#408F5E', // chart-8 success
};

export function getBuildingColor(
  metrics: BuildingMetrics, 
  mode: MapColoringMode
): string {
  switch (mode) {
    case 'energy-efficiency': {
      const value = metrics.energyPerSqm;
      if (value < 90) return COLORS.green;
      if (value < 100) return COLORS.lightGreen;
      if (value < 120) return COLORS.yellow;
      if (value < 140) return COLORS.orange;
      return COLORS.red;
    }
    
    case 'work-orders': {
      const count = metrics.workOrders;
      if (count <= 2) return COLORS.green;
      if (count <= 5) return COLORS.yellow;
      if (count <= 10) return COLORS.orange;
      return COLORS.red;
    }
    
    case 'co2': {
      const tons = metrics.co2Tons;
      if (tons < 50) return COLORS.green;
      if (tons < 100) return COLORS.lightGreen;
      if (tons < 200) return COLORS.yellow;
      if (tons < 400) return COLORS.orange;
      return COLORS.red;
    }
    
    case 'energy-rating': {
      switch (metrics.energyRating) {
        case 'A': return COLORS.darkGreen;
        case 'B': return COLORS.green;
        case 'C': return COLORS.yellow;
        case 'D': return COLORS.orange;
        case 'E': return COLORS.red;
      }
    }
    
    default:
      return COLORS.green;
  }
}

// Deterministic hash function for consistent mock data
function hashString(str: string): number {
  return str.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

export function generateMockBuildingMetrics(
  fmGuid: string,
  area: number
): BuildingMetrics {
  const hash = hashString(fmGuid);
  
  // Generate deterministic values based on hash
  const energyBase = 70 + (hash % 100); // 70-170 kWh/m²
  const workOrderBase = hash % 15; // 0-14 work orders
  const co2Base = area * 0.012 * (0.5 + (hash % 100) / 100); // Based on area with variation
  
  // Energy rating based on energy efficiency
  const ratings: EnergyRating[] = ['A', 'B', 'C', 'D', 'E'];
  const ratingIndex = Math.min(Math.floor(energyBase / 30), 4);
  
  return {
    fmGuid,
    energyPerSqm: Math.round(energyBase * 10) / 10,
    workOrders: workOrderBase,
    co2Tons: Math.round(co2Base * 10) / 10,
    energyRating: ratings[ratingIndex],
  };
}

export const COLORING_MODE_LABELS: Record<MapColoringMode, string> = {
  'none': 'Default',
  'energy-efficiency': 'Energy Efficiency (kWh/m²)',
  'work-orders': 'Work Orders',
  'co2': 'CO₂ Emissions',
  'energy-rating': 'Energy Rating',
};

export const COLORING_MODE_LEGENDS: Record<Exclude<MapColoringMode, 'none'>, { label: string; color: string }[]> = {
  'energy-efficiency': [
    { label: '< 90', color: COLORS.green },
    { label: '90-100', color: COLORS.lightGreen },
    { label: '100-120', color: COLORS.yellow },
    { label: '120-140', color: COLORS.orange },
    { label: '> 140', color: COLORS.red },
  ],
  'work-orders': [
    { label: '0-2', color: COLORS.green },
    { label: '3-5', color: COLORS.yellow },
    { label: '6-10', color: COLORS.orange },
    { label: '> 10', color: COLORS.red },
  ],
  'co2': [
    { label: '< 50t', color: COLORS.green },
    { label: '50-100t', color: COLORS.lightGreen },
    { label: '100-200t', color: COLORS.yellow },
    { label: '200-400t', color: COLORS.orange },
    { label: '> 400t', color: COLORS.red },
  ],
  'energy-rating': [
    { label: 'A', color: COLORS.darkGreen },
    { label: 'B', color: COLORS.green },
    { label: 'C', color: COLORS.yellow },
    { label: 'D', color: COLORS.orange },
    { label: 'E', color: COLORS.red },
  ],
};
