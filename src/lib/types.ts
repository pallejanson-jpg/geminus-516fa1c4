export type GroupedFacilities = {
    [key: string]: any[];
};

export interface Facility {
    fmGuid: string;
    name: string;
    commonName?: string;
    buildingCommonName?: string;
    complexCommonName?: string;
    image?: string;
    coordinates?: { lat: number; lng: number };
    area?: string | number;
    grossArea?: string | number;
    numberOfLevels?: number | string;
    numberOfSpaces?: number;
    category?: string;
}

export interface AppConfig {
    label: string;
    url: string;
    icon: React.ComponentType<any>;
    openMode: 'internal' | 'external';
    username?: string;
    password?: string;
}
