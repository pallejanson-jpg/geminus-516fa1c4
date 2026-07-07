import { useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { toast } from 'sonner';

import { emit } from '@/lib/event-bus';
interface VoiceCommand {
  patterns: RegExp[];
  action: (
    ctx: ReturnType<typeof useApp>,
    match: RegExpMatchArray,
    callbacks: VoiceCommandCallbacks
  ) => void;
  description: string;
  category: 'navigation' | 'search' | '3d' | 'viewer' | 'assistant' | 'help';
}

interface VoiceCommandCallbacks {
  onSearch?: (term: string) => void;
  onOpenGunnar?: () => void;
  onAskGunnar?: (question: string) => void;
}

// Helper to find a building by name in the tree
function findBuilding(
  treeData: any[],
  searchTerm: string
): { fmGuid: string; name: string } | null {
  const normalizedSearch = searchTerm.toLowerCase().trim();
  for (const node of treeData) {
    const nodeName = (node.commonName || node.name || '').toLowerCase();
    if (nodeName.includes(normalizedSearch) || normalizedSearch.includes(nodeName)) {
      return { fmGuid: node.fmGuid, name: node.commonName || node.name };
    }
  }
  return null;
}

const VOICE_COMMANDS: VoiceCommand[] = [
  // === Navigation Commands ===
  {
    patterns: [
      /^(öppna|gå till|visa)\s+(hem|home|startsidan|start)$/i,
      /^(start|hem|home)$/i,
    ],
    action: (ctx) => { ctx.setActiveApp('home'); },
    description: 'Open home',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|gå till|visa)\s+(portfolio|portfölj|fastigheter|byggnader)$/i,
      /^portfolio$/i,
    ],
    action: (ctx) => { ctx.setActiveApp('portfolio'); },
    description: 'Open portfolio',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|starta|visa)\s+(navigator|navigatorn|träd|trädvy|trädvyn)$/i,
      /^navigator$/i,
    ],
    action: (ctx) => { ctx.setActiveApp('navigation'); },
    description: 'Open navigator',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|visa)\s+(karta|kartan|map)$/i,
      /^karta$/i,
    ],
    action: (ctx) => { ctx.setActiveApp('map'); },
    description: 'Open map',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|visa)\s+(insights|insikter|statistik|analytics)$/i,
      /^insights$/i,
    ],
    action: (ctx) => { ctx.setActiveApp('insights'); },
    description: 'Open insights',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|visa)\s+(inventering|inventariet|inventory)$/i,
      /^inventering$/i,
    ],
    action: (ctx) => { ctx.setActiveApp('inventory'); },
    description: 'Open inventory',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|visa|skapa)\s+(felanmälan|felrapport|fault report)$/i,
      /^felanmälan$/i,
    ],
    action: (ctx) => { ctx.setActiveApp('fault_report'); },
    description: 'Open fault report',
    category: 'navigation',
  },

  // === 3D / Viewer Commands ===
  {
    patterns: [
      /^(öppna|visa)\s+(3d|tre-?d|viewer|visare|visaren|3d-?visare|3d-?visaren)$/i,
    ],
    action: (ctx) => { ctx.setActiveApp('native_viewer'); },
    description: 'Open 3D viewer',
    category: '3d',
  },
  {
    patterns: [
      /^visa\s+(.+?)\s+i\s+3d$/i,
      /^öppna\s+(.+?)\s+i\s+3d$/i,
      /^ladda\s+(.+?)\s+i\s+3d$/i,
    ],
    action: (ctx, match) => {
      const searchTerm = match[1];
      const building = findBuilding(ctx.navigatorTreeData, searchTerm);
      if (building) {
        ctx.setViewer3dFmGuid(building.fmGuid);
        toast.success(`Opening ${building.name} in 3D`);
      } else {
        toast.error(`No building found matching "${searchTerm}"`);
      }
    },
    description: 'Show [building] in 3D',
    category: '3d',
  },
  {
    patterns: [
      /^(stäng|avsluta|lämna)\s+(3d|tre-?d|visaren|3d-?visare|3d-?visaren)$/i,
    ],
    action: (ctx) => { ctx.setViewer3dFmGuid(null); },
    description: 'Close 3D viewer',
    category: '3d',
  },
  {
    patterns: [
      /^(byt byggnad till|välj byggnad|byt till)\s+(.+)$/i,
    ],
    action: (ctx, match) => {
      const searchTerm = match[2];
      const building = findBuilding(ctx.navigatorTreeData, searchTerm);
      if (building) {
        ctx.setViewer3dFmGuid(building.fmGuid);
        toast.success(`Switching to ${building.name}`);
      } else {
        toast.error(`No building found: "${searchTerm}"`);
      }
    },
    description: 'Switch building to [name]',
    category: '3d',
  },

  // === View mode commands ===
  {
    patterns: [
      /^(byt till|visa|öppna)\s+(2d|två-?d|planvy|planvyn)$/i,
      /^2d$/i,
    ],
    action: (ctx) => {
      ctx.setViewMode('2d');
      window.dispatchEvent(new CustomEvent('VIEW_MODE_2D_TOGGLED', { detail: { enabled: true } }));
    },
    description: 'Switch to 2D view',
    category: 'viewer',
  },
  {
    patterns: [
      /^(byt till|visa|öppna)\s+(3d-?vy|tre-?d-?vy)$/i,
    ],
    action: (ctx) => {
      ctx.setViewMode('3d');
      window.dispatchEvent(new CustomEvent('VIEW_MODE_2D_TOGGLED', { detail: { enabled: false } }));
    },
    description: 'Switch to 3D view',
    category: 'viewer',
  },
  {
    patterns: [
      /^(byt till|visa|öppna)\s+(360|panorama|panoramavy)$/i,
      /^360$/i,
    ],
    action: (ctx) => { ctx.setViewMode('360'); },
    description: 'Open 360° view',
    category: 'viewer',
  },
  {
    patterns: [
      /^(byt till|visa|öppna)\s+(split|delad vy|delad|splitvy)$/i,
    ],
    action: (ctx) => { ctx.setViewMode('split'); },
    description: 'Show split view',
    category: 'viewer',
  },

  // === Floor commands ===
  {
    patterns: [
      /^(visa|gå till|isolera)\s+(våning|plan|etage)\s+(\d+|[-\d]+)$/i,
    ],
    action: (_ctx, match) => {
      const floorNumber = match[3];
      emit('VOICE_FLOOR_SELECT', { floorNumber });
      toast.info(`Isolating floor ${floorNumber}`);
    },
    description: 'Show floor [number]',
    category: 'viewer',
  },

  // === Room commands ===
  {
    patterns: [
      /^(visa|gå till|hitta)\s+(rum|room)\s+(.+)$/i,
    ],
    action: (_ctx, match, callbacks) => {
      const roomSearch = match[3];
      callbacks.onSearch?.(`room ${roomSearch}`);
      toast.info(`Searching for room ${roomSearch}`);
    },
    description: 'Show room [name/number]',
    category: 'viewer',
  },

  // === Search Commands ===
  {
    patterns: [
      /^(sök|hitta|leta efter|finn)\s+(.+)$/i,
    ],
    action: (_ctx, match, callbacks) => {
      const searchTerm = match[2];
      callbacks.onSearch?.(searchTerm);
    },
    description: 'Search for [object]',
    category: 'search',
  },

  // === Issue commands ===
  {
    patterns: [
      /^(skapa|ny|rapportera)\s+(ärende|issue|avvikelse)$/i,
    ],
    action: (ctx) => {
      ctx.setActiveApp('native_viewer');
      // Dispatch event to open issue dialog
      setTimeout(() => emit('VOICE_CREATE_ISSUE'), 500);
    },
    description: 'Create issue',
    category: 'navigation',
  },

  // === Filter commands ===
  {
    patterns: [
      /^(rensa|ta bort)\s+(filter|filtrering|alla filter)$/i,
    ],
    action: () => {
      emit('VOICE_CLEAR_FILTERS');
      toast.info('Filters cleared');
    },
    description: 'Clear filters',
    category: 'viewer',
  },

  // === Assistant Commands ===
  {
    patterns: [
      /^(prata med|öppna|starta)\s+(gunnar|assistenten|ai|chatten)$/i,
      /^gunnar$/i,
    ],
    action: (_ctx, _match, callbacks) => { callbacks.onOpenGunnar?.(); },
    description: 'Open Gunnar',
    category: 'assistant',
  },
  {
    patterns: [
      /^(fråga gunnar|hej gunnar|gunnar)[,:.]?\s+(.+)$/i,
    ],
    action: (_ctx, match, callbacks) => {
      const question = match[2];
      callbacks.onAskGunnar?.(question);
    },
    description: 'Ask Gunnar [question]',
    category: 'assistant',
  },

  // === Help Commands ===
  {
    patterns: [
      /^(hjälp|help|vilka kommandon|kommandon|vad kan jag säga).*$/i,
    ],
    action: () => {},
    description: 'Show help',
    category: 'help',
  },
];

export interface VoiceCommandResult {
  matched: boolean;
  command?: VoiceCommand;
  feedback?: string;
  isHelpCommand?: boolean;
}

export function useVoiceCommands(callbacks: VoiceCommandCallbacks = {}) {
  const appContext = useApp();

  const executeCommand = useCallback(
    (transcript: string): VoiceCommandResult => {
      const normalizedTranscript = transcript.toLowerCase().trim();
      
      for (const command of VOICE_COMMANDS) {
        for (const pattern of command.patterns) {
          const match = normalizedTranscript.match(pattern);
          if (match) {
            if (command.category === 'help') {
              return { matched: true, command, feedback: 'Showing help', isHelpCommand: true };
            }
            command.action(appContext, match, callbacks);
            return { matched: true, command, feedback: command.description };
          }
        }
      }
      return { matched: false };
    },
    [appContext, callbacks]
  );

  const getAvailableCommands = useCallback(() => {
    return VOICE_COMMANDS.map((cmd) => ({
      description: cmd.description,
      category: cmd.category,
      examples: cmd.patterns.map((p) => 
        p.source
          .replace(/\^|\$|\(\?:|\)/g, '')
          .replace(/\|/g, ' / ')
          .replace(/\\s\+/g, ' ')
          .replace(/\\s\*/g, ' ')
          .replace(/\.\+\??/g, '[...]')
          .replace(/\.\*\??/g, '')
      ).slice(0, 2),
    }));
  }, []);

  return { executeCommand, getAvailableCommands, commands: VOICE_COMMANDS };
}

export type { VoiceCommand, VoiceCommandCallbacks };
