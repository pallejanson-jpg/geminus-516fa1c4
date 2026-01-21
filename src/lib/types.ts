export type GroupedFacilities = {
    [key: string]: any[];
};

export interface Facility {
    fmGuid?: string;
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
}

export interface AppConfig {
    label: string;
    url: string;
    icon: React.ComponentType<any>;
    openMode: 'internal' | 'external';
    username?: string;
    password?: string;
}
