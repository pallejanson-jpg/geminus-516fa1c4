/**
 * Visualization utilities for room color-coding based on sensor data
 */

export type VisualizationType = 'temperature' | 'co2' | 'humidity' | 'occupancy' | 'area' | 'light' | 'anomaly' | 'none';

export interface ColorStop {
  value: number;
  color: [number, number, number]; // RGB 0-255
}

export interface VisualizationConfig {
  type: VisualizationType;
  label: string;
  unit: string;
  colorStops: ColorStop[];
  min: number;
  max: number;
}

// Color scales for different visualization types
export const VISUALIZATION_CONFIGS: Record<VisualizationType, VisualizationConfig> = {
  temperature: {
    type: 'temperature',
    label: 'Temperature',
    unit: '°C',
    colorStops: [
      { value: 16, color: [59, 130, 246] },   // Blue - cold
      { value: 18, color: [59, 130, 246] },   // Blue
      { value: 20, color: [34, 197, 94] },    // Green - ideal
      { value: 22, color: [34, 197, 94] },    // Green
      { value: 24, color: [234, 179, 8] },    // Yellow - warm
      { value: 26, color: [239, 68, 68] },    // Red - hot
      { value: 30, color: [239, 68, 68] },    // Red
    ],
    min: 16,
    max: 30,
  },
  co2: {
    type: 'co2',
    label: 'CO₂',
    unit: 'ppm',
    colorStops: [
      { value: 400, color: [34, 197, 94] },   // Green - excellent
      { value: 600, color: [34, 197, 94] },   // Green
      { value: 800, color: [234, 179, 8] },   // Yellow - acceptable
      { value: 1000, color: [234, 179, 8] },  // Yellow
      { value: 1200, color: [249, 115, 22] }, // Orange - poor
      { value: 1500, color: [239, 68, 68] },  // Red - bad
      { value: 2000, color: [239, 68, 68] },  // Red
    ],
    min: 400,
    max: 2000,
  },
  humidity: {
    type: 'humidity',
    label: 'Humidity',
    unit: '%',
    colorStops: [
      { value: 20, color: [249, 115, 22] },   // Orange - too dry
      { value: 30, color: [234, 179, 8] },    // Yellow
      { value: 40, color: [34, 197, 94] },    // Green - ideal start
      { value: 60, color: [34, 197, 94] },    // Green - ideal end
      { value: 70, color: [59, 130, 246] },   // Blue - humid
      { value: 80, color: [59, 130, 246] },   // Blue - too humid
    ],
    min: 20,
    max: 80,
  },
  occupancy: {
    type: 'occupancy',
    label: 'Occupancy',
    unit: '%',
    colorStops: [
      { value: 0, color: [156, 163, 175] },   // Gray - empty
      { value: 25, color: [34, 197, 94] },    // Green - light
      { value: 50, color: [234, 179, 8] },    // Yellow - moderate
      { value: 75, color: [249, 115, 22] },   // Orange - busy
      { value: 100, color: [239, 68, 68] },   // Red - full
    ],
    min: 0,
    max: 100,
  },
  light: {
    type: 'light',
    label: 'Light',
    unit: 'lux',
    colorStops: [
      { value: 0, color: [30, 30, 30] },       // Very dark
      { value: 50, color: [100, 100, 100] },    // Dim
      { value: 200, color: [234, 179, 8] },     // Yellow - moderate
      { value: 500, color: [250, 204, 21] },    // Bright yellow
      { value: 1000, color: [253, 224, 71] },   // Light yellow
      { value: 2000, color: [254, 249, 195] },  // Very bright
    ],
    min: 0,
    max: 2000,
  },
  area: {
    type: 'area',
    label: 'Yta (NTA)',
    unit: 'm²',
    colorStops: [
      { value: 0, color: [255, 255, 255] },   // White - smallest
      { value: 25, color: [233, 213, 255] },  // Light purple
      { value: 50, color: [192, 132, 252] },  // Purple
      { value: 100, color: [147, 51, 234] },  // Darker purple
      { value: 200, color: [126, 34, 206] },  // Deep purple
    ],
    min: 0,
    max: 200,
  },
  anomaly: {
    type: 'anomaly',
    label: 'Anomalier',
    unit: 'poäng',
    colorStops: [
      { value: 0, color: [34, 197, 94] },     // Green - normal
      { value: 25, color: [34, 197, 94] },    // Green
      { value: 50, color: [234, 179, 8] },    // Yellow - mild anomaly
      { value: 75, color: [249, 115, 22] },   // Orange - significant
      { value: 100, color: [239, 68, 68] },   // Red - critical anomaly
    ],
    min: 0,
    max: 100,
  },
  none: {
    type: 'none',
    label: 'Ingen',
    unit: '',
    colorStops: [],
    min: 0,
    max: 0,
  },
};

/**
 * Normalize a value to 0-1 range
 */
export function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Interpolate between two colors
 */
export function interpolateColor(
  color1: [number, number, number],
  color2: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(color1[0] + (color2[0] - color1[0]) * t),
    Math.round(color1[1] + (color2[1] - color1[1]) * t),
    Math.round(color1[2] + (color2[2] - color1[2]) * t),
  ];
}

/**
 * Get color for a value based on the visualization type
 */
export function getVisualizationColor(
  value: number | null | undefined,
  type: VisualizationType
): [number, number, number] | null {
  if (value === null || value === undefined || type === 'none') {
    return null;
  }

  const config = VISUALIZATION_CONFIGS[type];
  if (!config || config.colorStops.length === 0) {
    return null;
  }

  const stops = config.colorStops;

  // Below minimum
  if (value <= stops[0].value) {
    return stops[0].color;
  }

  // Above maximum
  if (value >= stops[stops.length - 1].value) {
    return stops[stops.length - 1].color;
  }

  // Find the two stops we're between
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].value && value <= stops[i + 1].value) {
      const t = (value - stops[i].value) / (stops[i + 1].value - stops[i].value);
      return interpolateColor(stops[i].color, stops[i + 1].color, t);
    }
  }

  return stops[0].color;
}

/**
 * Convert RGB to hex color string
 */
export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert RGB (0-255) to normalized float array (0-1) for xeokit
 */
export function rgbToFloat(rgb: [number, number, number]): [number, number, number] {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/**
 * Convert an HSL string like 'hsl(220, 80%, 55%)' or 'hsl(var(--chart-2))' to normalized RGB floats [0-1] for xeokit.
 * Resolves CSS custom properties (var(--name)) by reading computed styles from the document.
 */
export function hslStringToRgbFloat(hsl: string): [number, number, number] {
  // Resolve CSS variables: 'hsl(var(--chart-2))' → read computed value → 'hsl(220 80% 55%)'
  let resolved = hsl;
  const varMatch = hsl.match(/var\(\s*(--[\w-]+)\s*\)/);
  if (varMatch) {
    try {
      const rawValue = getComputedStyle(document.documentElement).getPropertyValue(varMatch[1]).trim();
      if (rawValue) {
        // rawValue is typically "220 80% 55%" (space-separated HSL components from Tailwind)
        resolved = `hsl(${rawValue})`;
      }
    } catch { /* SSR or no DOM */ }
  }

  // Support both comma-separated 'hsl(220, 80%, 55%)' and space-separated 'hsl(220 80% 55%)'
  const match = resolved.match(/hsl\(\s*([\d.]+)[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?\s*\)/i);
  if (!match) return [0.5, 0.5, 0.5];
  const h = parseFloat(match[1]) / 360;
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p2 = 2 * l - q2;
    r = hue2rgb(p2, q2, h + 1 / 3);
    g = hue2rgb(p2, q2, h);
    b = hue2rgb(p2, q2, h - 1 / 3);
  }
  return [Math.round(r * 1000) / 1000, Math.round(g * 1000) / 1000, Math.round(b * 1000) / 1000];
}

/**
 * Generate mock sensor data for demonstration
 */
export function generateMockSensorData(fmGuid: string, type: VisualizationType): number | null {
  // Use fmGuid hash to generate consistent random values
  const hash = fmGuid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const random = (hash * 9301 + 49297) % 233280 / 233280;

  const config = VISUALIZATION_CONFIGS[type];
  if (!config || type === 'none') return null;

  // Generate value within range with some variation
  const range = config.max - config.min;
  return config.min + random * range;
}

export interface RoomSensorData {
  fmGuid: string;
  temperature?: number | null;
  co2?: number | null;
  humidity?: number | null;
  occupancy?: number | null;
  light?: number | null;
  area?: number | null;
}

/**
 * Extract sensor value from room attributes based on visualization type
 */
export function extractSensorValue(
  attributes: Record<string, any> | null | undefined,
  type: VisualizationType
): number | null {
  if (!attributes || type === 'none') return null;

  // Find keys that match sensor patterns (normalize by stripping spaces/underscores/dashes)
  const keys = Object.keys(attributes);
  const normalize = (k: string) => k.toLowerCase().replace(/[\s_-]/g, '');
  
  const findKey = (patterns: string[]) =>
    keys.find(k => { const nk = normalize(k); return patterns.some(p => nk.includes(p)); });
  
  const extractVal = (key: string | undefined) => {
    if (!key) return null;
    const val = attributes[key];
    if (typeof val === 'number') return val;
    if (typeof val === 'string') { const n = parseFloat(val); return isNaN(n) ? null : n; }
    if (typeof val?.value === 'number') return val.value;
    return null;
  };

  switch (type) {
    case 'temperature':
      return extractVal(findKey(['sensortemperature', 'temperature', 'temp']));
    case 'co2':
      return extractVal(findKey(['sensorco2', 'co2', 'carbondioxide']));
    case 'humidity':
      return extractVal(findKey(['sensorhum', 'humidity', 'rh']));
    case 'occupancy':
      return extractVal(findKey(['sensoroccupancy', 'occupancy', 'presence']));
    case 'area': {
      // Look for NTA or area values
      const areaKey = keys.find(k => k.toLowerCase().includes('nta') || k.toLowerCase() === 'area');
      if (areaKey) {
        const val = attributes[areaKey];
        return typeof val === 'number' ? val : (typeof val?.value === 'number' ? val.value : null);
      }
      return null;
    }
    default:
      return null;
  }
}
