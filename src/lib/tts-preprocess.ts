/**
 * Text preprocessing for ElevenLabs TTS
 * Expands abbreviations, adds natural pauses, cleans markdown
 */

/** Swedish & common abbreviations → full words */
const ABBREVIATIONS: Record<string, string> = {
  'dr.': 'doktor',
  'Dr.': 'Doktor',
  'prof.': 'professor',
  'Prof.': 'Professor',
  'ing.': 'ingenjör',
  'Ing.': 'Ingenjör',
  'st.': 'stycken',
  'nr.': 'nummer',
  'Nr.': 'Nummer',
  'tel.': 'telefon',
  'Tel.': 'Telefon',
  'ca.': 'cirka',
  'Ca.': 'Cirka',
  'bl.a.': 'bland annat',
  't.ex.': 'till exempel',
  'd.v.s.': 'det vill säga',
  'o.s.v.': 'och så vidare',
  'f.d.': 'före detta',
  's.k.': 'så kallad',
  'osv.': 'och så vidare',
  'resp.': 'respektive',
  'inkl.': 'inklusive',
  'exkl.': 'exklusive',
  'ev.': 'eventuellt',
  'dvs.': 'det vill säga',
  'tex.': 'till exempel',
  'kvm': 'kvadratmeter',
  'm²': 'kvadratmeter',
  'm2': 'kvadratmeter',
  '°C': 'grader celsius',
  'ppm': 'PPM',
  'kWh': 'kilowattimmar',
  'kW': 'kilowatt',
  'MW': 'megawatt',
  'W': 'watt',
  'CO2': 'CO2',
};

/** Sort abbreviation keys by length (longest first) for greedy matching */
const SORTED_ABBR_KEYS = Object.keys(ABBREVIATIONS).sort((a, b) => b.length - a.length);

function expandAbbreviations(text: string): string {
  let result = text;
  for (const abbr of SORTED_ABBR_KEYS) {
    // Use word-boundary-safe replacement
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<=\\s|^)${escaped}(?=\\s|$|[,;:!?])`, 'g');
    result = result.replace(regex, ABBREVIATIONS[abbr]);
  }
  return result;
}

/** Remove markdown formatting but preserve sentence structure */
function cleanMarkdown(text: string): string {
  return text
    // Remove emoji characters (common unicode ranges)
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    // Remove bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove headers but keep text
    .replace(/^#{1,6}\s+/gm, '')
    // Convert bullet points to commas for flow
    .replace(/^[-•]\s+/gm, '... ')
    // Convert numbered lists
    .replace(/^\d+\.\s+/gm, '... ')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove block quotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, '...')
    // Remove subscript notation like CO₂
    .replace(/CO₂/g, 'CO2');
}

/** Add natural pauses at punctuation boundaries */
function addNaturalPauses(text: string): string {
  return text
    // Ensure pause after colons (like "Status: ...")
    .replace(/:\s*/g, ': ... ')
    // Slightly longer pause between paragraphs
    .replace(/\n\n+/g, ' ... ... ')
    // Normal pause at line breaks
    .replace(/\n/g, ' ... ')
    // Avoid triple+ dots
    .replace(/\.{4,}/g, '...');
}

/** Clean up whitespace */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Preprocess text for ElevenLabs TTS:
 * 1. Clean markdown
 * 2. Expand abbreviations
 * 3. Add natural pauses
 * 4. Normalize whitespace
 */
export function preprocessForTTS(text: string): string {
  if (!text?.trim()) return '';

  let result = text;
  result = cleanMarkdown(result);
  result = expandAbbreviations(result);
  result = addNaturalPauses(result);
  result = normalizeWhitespace(result);

  // Truncate for ElevenLabs limit (5000 chars)
  if (result.length > 4800) {
    result = result.slice(0, 4800) + '... och mer.';
  }

  return result;
}
