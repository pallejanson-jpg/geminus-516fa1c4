import { useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { toast } from 'sonner';

interface VoiceCommand {
  patterns: RegExp[];
  action: (
    ctx: ReturnType<typeof useApp>,
    match: RegExpMatchArray,
    callbacks: VoiceCommandCallbacks
  ) => void;
  description: string;
  category: 'navigation' | 'search' | '3d' | 'assistant' | 'help';
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
    action: (ctx) => {
      ctx.setActiveApp('home');
    },
    description: 'Öppna hem',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|gå till|visa)\s+(portfolio|portfölj|fastigheter|byggnader)$/i,
      /^portfolio$/i,
    ],
    action: (ctx) => {
      ctx.setActiveApp('portfolio');
    },
    description: 'Öppna portfolio',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|starta|visa)\s+(navigator|navigatorn|träd|trädvy|trädvyn)$/i,
      /^navigator$/i,
    ],
    action: (ctx) => {
      ctx.setActiveApp('navigation');
    },
    description: 'Öppna navigator',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|visa)\s+(karta|kartan|map)$/i,
      /^karta$/i,
    ],
    action: (ctx) => {
      ctx.setActiveApp('map');
    },
    description: 'Öppna karta',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|visa)\s+(insights|insikter|statistik|analytics)$/i,
      /^insights$/i,
    ],
    action: (ctx) => {
      ctx.setActiveApp('insights');
    },
    description: 'Öppna insights',
    category: 'navigation',
  },
  {
    patterns: [
      /^(öppna|visa)\s+(3d|tre-?d|viewer|visare|visaren|3d-?visare|3d-?visaren)$/i,
    ],
    action: (ctx) => {
      ctx.setActiveApp('assetplus_viewer');
    },
    description: 'Öppna 3D-visare',
    category: 'navigation',
  },

  // === 3D Commands ===
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
        toast.success(`Öppnar ${building.name} i 3D`);
      } else {
        toast.error(`Hittade ingen byggnad som matchar "${searchTerm}"`);
      }
    },
    description: 'Visa byggnad i 3D',
    category: '3d',
  },
  {
    patterns: [
      /^(stäng|avsluta|lämna)\s+(3d|tre-?d|visaren|3d-?visare|3d-?visaren)$/i,
      /^stäng\s+3d$/i,
    ],
    action: (ctx) => {
      ctx.setViewer3dFmGuid(null);
    },
    description: 'Stäng 3D-visare',
    category: '3d',
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
    description: 'Sök efter objekt',
    category: 'search',
  },

  // === Assistant Commands ===
  {
    patterns: [
      /^(prata med|öppna|starta)\s+(gunnar|assistenten|ai|chatten)$/i,
      /^gunnar$/i,
    ],
    action: (_ctx, _match, callbacks) => {
      callbacks.onOpenGunnar?.();
    },
    description: 'Öppna Gunnar',
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
    description: 'Fråga Gunnar',
    category: 'assistant',
  },

  // === Help Commands ===
  {
    patterns: [
      /^(hjälp|help|vilka kommandon|kommandon|vad kan jag säga).*$/i,
    ],
    action: () => {
      // Will be handled specially to show help dialog
    },
    description: 'Visa hjälp',
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
      
      // Try to match against all commands
      for (const command of VOICE_COMMANDS) {
        for (const pattern of command.patterns) {
          const match = normalizedTranscript.match(pattern);
          if (match) {
            // Special handling for help command
            if (command.category === 'help') {
              return {
                matched: true,
                command,
                feedback: 'Visar hjälp',
                isHelpCommand: true,
              };
            }

            // Execute the action
            command.action(appContext, match, callbacks);

            return {
              matched: true,
              command,
              feedback: command.description,
            };
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

  return {
    executeCommand,
    getAvailableCommands,
    commands: VOICE_COMMANDS,
  };
}

export type { VoiceCommand, VoiceCommandCallbacks };
