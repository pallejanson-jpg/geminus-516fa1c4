export type GroupedFacilities = {
    [key: string]: Facility[];
};

// ── Geometry manifest types (ACC pipeline) ──

export interface GeometryManifestChunk {
  storeyGuid: string;
  storeyName: string;
  priority: number;
  url: string;
  bbox: number[];
  elementCount: number;
  format: string;
}

export interface GeometryManifest {
  modelId: string;
  source: { accProjectId: string; accFileUrn: string; apsRegion: string };
  version: string;
  format: string;
  coordinateSystem: { up: string; units: string };
  materialPolicy: { textures: boolean };
  chunks: GeometryManifestChunk[];
  fallback: { url: string } | null;
}

export interface GeometryIndexEntry {
  externalId: string;
  storeyGuid: string;
  dbId: number;
  fm_guid: string | null;
}

// ── Core domain types ──

export interface Facility {
    fmGuid: string;
    name?: string;
    commonName?: string;
    buildingCommonName?: string;
    complexCommonName?: string;
    image?: string;
    coordinates?: { lat: number; lng: number };
    area?: number;
    grossArea?: number;
    numberOfLevels?: number;
    numberOfSpaces?: number;
    category?: string;
    address?: string;
    designation?: string;
    siteId?: string;
    buildingFmGuid?: string;
    levelFmGuid?: string;
    inRoomFmGuid?: string;
    attributes?: Record<string, any>;
    isLocal?: boolean;
    assetType?: string;
    createdInModel?: boolean;
    isSynthetic?: boolean;
    modificationDate?: string;
    sourceUpdatedAt?: string;
}

export interface NavigatorNode {
    fmGuid: string;
    category?: string;
    commonName?: string;
    name?: string;
    children?: NavigatorNode[];
    buildingFmGuid?: string;
    levelFmGuid?: string;
    inRoomFmGuid?: string;
    createdInModel?: boolean;
    isLocal?: boolean;
    isSynthetic?: boolean;
    complexCommonName?: string;
    attributes?: Record<string, any>;
}

export interface AppConfig {
    label: string;
    url: string;
    icon: React.ComponentType<any>;
    openMode: 'internal' | 'external';
    username?: string;
    password?: string;
    pollIntervalHours?: number;
}
