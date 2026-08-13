import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, SunMedium, Moon, Database, FileQuestion, Building2, Eye,
  Search, Filter, LayoutGrid, List, Layers, MapPin, Star, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { useAllBuildingSettings } from '@/hooks/useAllBuildingSettings';
import { extractSpaceArea } from '@/lib/building-utils';
import { supabase } from '@/integrations/supabase/client';
import { BUILDING_IMAGES } from '@/lib/constants';
import './new-ui-preview.css';

// This page reads REAL Geminus data (read-only) via the same hooks/context
// the real Home (src/components/home/HomeLanding.tsx) and Portfolio
// (src/components/portfolio/PortfolioView.tsx) pages use — AppContext's
// navigatorTreeData/allData, useAllBuildingSettings, and the saved_views
// table. Nothing here writes to those sources or modifies shared files.
type Building = {
  fmGuid: string;
  name: string;
  address?: string;
  complex: string;
  floors: number;
  rooms: number;
  area: number;
  favorite: boolean;
  image: string;
};

const RECENT_KEY = 'geminus-recent-buildings';

function readRecentBuildingGuids(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) || [];
    return parsed.map((b: any) => b.fmGuid).filter(Boolean);
  } catch { return []; }
}

// Same transformation PortfolioView.tsx uses: flatten Property nodes into
// Buildings, then compute floors/rooms/area from allData.
function useRealBuildings(): { buildings: Building[]; loading: boolean } {
  const { navigatorTreeData, allData, isLoadingData } = useContext(AppContext);
  const { getHeroImage, getFavorites, isLoading: isLoadingSettings } = useAllBuildingSettings();

  const buildings = useMemo<Building[]>(() => {
    const favoriteGuids = new Set(getFavorites());
    const nodes: Array<{ node: any; complexName?: string }> = [];
    navigatorTreeData.forEach((topNode: any) => {
      if (topNode.category === 'Property') {
        (topNode.children || []).forEach((child: any) => {
          nodes.push({ node: child, complexName: topNode.commonName || topNode.name });
        });
      } else {
        nodes.push({ node: topNode, complexName: topNode.complexCommonName });
      }
    });

    return nodes.map(({ node, complexName }, index) => {
      const spaces = allData.filter((a: any) => a.category === 'Space' && a.buildingFmGuid === node.fmGuid);
      const storeys = allData.filter((a: any) => a.category === 'Building Storey' && a.buildingFmGuid === node.fmGuid);
      const area = spaces.reduce((sum: number, space: any) => sum + extractSpaceArea(space), 0);
      return {
        fmGuid: node.fmGuid,
        name: node.commonName || node.name,
        address: node.attributes?.address || undefined,
        complex: complexName || 'Other buildings',
        floors: storeys.length,
        rooms: spaces.length,
        area: Math.round(area),
        favorite: favoriteGuids.has(node.fmGuid),
        image: getHeroImage(node.fmGuid, BUILDING_IMAGES[index % BUILDING_IMAGES.length]),
      };
    });
  }, [navigatorTreeData, allData, getHeroImage, getFavorites]);

  return { buildings, loading: isLoadingData || isLoadingSettings };
}

type SavedView = {
  id: string;
  name: string;
  screenshot_url: string | null;
  building_name: string | null;
};

function useRealSavedViews(): { views: SavedView[]; loading: boolean } {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('saved_views')
        .select('id, name, screenshot_url, building_name, building_fm_guid, created_at')
        .order('created_at', { ascending: false })
        .limit(6);
      if (!cancelled) {
        setViews(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { views, loading };
}

// Scrolls the nearest carousel track — works generically for any row without per-row refs.
const scrollTrack = (btn: HTMLButtonElement, dir: number) => {
  const track = btn.closest('.ngui-carousel')?.querySelector('.ngui-carousel-track') as HTMLElement | null;
  track?.scrollBy({ left: dir * 320, behavior: 'smooth' });
};

const BuildingTile: React.FC<{ b: Building }> = ({ b }) => (
  <div className="ngui-tile">
    <div className="ngui-tile-img" style={{ backgroundImage: `url(${b.image})` }}>
      <div className="ngui-tile-overlay">
        <div className="ngui-tile-title">{b.name}</div>
        {b.address && <div className="ngui-tile-subtitle"><MapPin size={11} />{b.address}</div>}
      </div>
    </div>
    <div className="ngui-tile-stats">
      <div className="ngui-tile-stat"><span className="ngui-tile-stat-value">{b.floors}</span><span className="ngui-tile-stat-label">fl</span></div>
      <div className="ngui-tile-stat"><span className="ngui-tile-stat-value">{b.rooms}</span><span className="ngui-tile-stat-label">rm</span></div>
      <div className="ngui-tile-stat"><span className="ngui-tile-stat-value">{b.area.toLocaleString('en-US')}</span><span className="ngui-tile-stat-label">m²</span></div>
    </div>
  </div>
);

const EmptyRow: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="ngui-empty-row">{icon}<span>{text}</span></div>
);

const CarouselRow: React.FC<{ icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }> = ({ icon, title, subtitle, children }) => (
  <div className="ngui-carousel">
    <div className="ngui-carousel-head">
      <div>
        <h3 className="ngui-section-title">{icon}{title}</h3>
        <p className="ngui-section-desc">{subtitle}</p>
      </div>
      <div className="ngui-carousel-nav">
        <button className="ngui-icon-btn" onClick={(e) => scrollTrack(e.currentTarget, -1)}><ChevronLeft size={16} /></button>
        <button className="ngui-icon-btn" onClick={(e) => scrollTrack(e.currentTarget, 1)}><ChevronRight size={16} /></button>
      </div>
    </div>
    <div className="ngui-carousel-track">{children}</div>
  </div>
);

const HomeTab: React.FC = () => {
  const { buildings, loading } = useRealBuildings();
  const { views, loading: loadingViews } = useRealSavedViews();
  const recentGuids = useMemo(() => readRecentBuildingGuids(), []);
  const recent = recentGuids.map((guid) => buildings.find((b) => b.fmGuid === guid)).filter(Boolean) as Building[];

  return (
    <>
      <div className="ngui-home-header">
        <h1 className="ngui-home-title">Welcome to My Geminus</h1>
        <p className="ngui-home-subtitle">Your digital backbone for digital twins</p>
      </div>

      <h3 className="ngui-section-title">AI Assistants</h3>
      <p className="ngui-section-desc">Quick help for data, documents and integrations</p>
      <div className="ngui-ai-grid">
        <div className="ngui-ai-card">
          <div className="ngui-ai-icon"><Database size={20} /></div>
          <div>
            <div className="ngui-ai-title">Geminus AI</div>
            <div className="ngui-ai-desc">Ask about buildings, rooms and assets</div>
          </div>
        </div>
        <div className="ngui-ai-card">
          <div className="ngui-ai-icon"><FileQuestion size={20} /></div>
          <div>
            <div className="ngui-ai-title">Ilean</div>
            <div className="ngui-ai-desc">Search documents and drawings</div>
          </div>
        </div>
      </div>

      <CarouselRow icon={<Building2 size={16} style={{ verticalAlign: -2, marginRight: 6 }} />} title="Recent" subtitle="Buildings you recently worked with">
        {loading ? (
          <EmptyRow icon={<Building2 size={18} />} text="Loading buildings…" />
        ) : recent.length > 0 ? (
          recent.map((b) => <BuildingTile key={b.fmGuid} b={b} />)
        ) : (
          <EmptyRow icon={<Building2 size={18} />} text="No recent buildings. Open a building from Portfolio to see it here." />
        )}
      </CarouselRow>

      <CarouselRow icon={<Eye size={16} style={{ verticalAlign: -2, marginRight: 6 }} />} title="Saved Views" subtitle="Your most recently saved views">
        {loadingViews ? (
          <EmptyRow icon={<Eye size={18} />} text="Loading saved views…" />
        ) : views.length > 0 ? (
          views.map((v) => (
            <div className="ngui-tile" key={v.id}>
              <div className="ngui-tile-img" style={v.screenshot_url ? { backgroundImage: `url(${v.screenshot_url})` } : undefined}>
                {!v.screenshot_url && <div className="ngui-tile-placeholder"><Eye size={22} /></div>}
                <div className="ngui-tile-overlay">
                  <div className="ngui-tile-title">{v.name}</div>
                  {v.building_name && <div className="ngui-tile-subtitle">{v.building_name}</div>}
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyRow icon={<Eye size={18} />} text="No saved views. Save a view from the 3D viewer to see it here." />
        )}
      </CarouselRow>
    </>
  );
};

const PortfolioTab: React.FC = () => {
  const { buildings, loading } = useRealBuildings();
  const [search, setSearch] = useState('');
  const [listMode, setListMode] = useState(false);

  const featured = buildings[0];
  const favorites = buildings.filter((b) => b.favorite);
  const complexes = Array.from(new Set(buildings.map((b) => b.complex)));
  const filtered = buildings.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()));

  const totals = {
    buildings: buildings.length,
    rooms: buildings.reduce((s, b) => s + b.rooms, 0),
    area: buildings.reduce((s, b) => s + b.area, 0),
    properties: complexes.length,
  };

  if (loading && buildings.length === 0) {
    return <EmptyRow icon={<Building2 size={18} />} text="Loading your portfolio…" />;
  }

  if (buildings.length === 0) {
    return <EmptyRow icon={<Building2 size={18} />} text="No buildings found. Sync data from Geminus Plus to see your portfolio here." />;
  }

  return (
    <>
      {featured && (
        <div className="ngui-tile ngui-hero" style={{ backgroundImage: `url(${featured.image})` }}>
          <span className="ngui-tile-badge"><Star size={11} /> Featured</span>
          <div className="ngui-tile-overlay">
            <div className="ngui-hero-title">{featured.name}</div>
            <div className="ngui-hero-stats">{featured.floors} floors · {featured.rooms} rooms · {featured.area.toLocaleString('en-US')} m² area</div>
            <div className="ngui-hero-actions">
              <button className="ngui-btn-filled">View details</button>
              <button className="ngui-btn-outline">Open 3D</button>
            </div>
          </div>
        </div>
      )}

      <div className="ngui-portfolio-header">
        <div>
          <h2 className="ngui-section-title" style={{ fontSize: 20 }}>Portfolio</h2>
          <p className="ngui-section-desc">Overview of all your buildings</p>
        </div>
      </div>

      <div className="ngui-filter-bar">
        <div className="ngui-search-wrap">
          <Search size={15} />
          <input className="ngui-search-input" placeholder="Search properties..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="ngui-back-btn"><Filter size={14} />All categories</button>
        <div className="ngui-view-toggle">
          <button className={`ngui-icon-btn ${!listMode ? 'active' : ''}`} onClick={() => setListMode(false)}><LayoutGrid size={15} /></button>
          <button className={`ngui-icon-btn ${listMode ? 'active' : ''}`} onClick={() => setListMode(true)}><List size={15} /></button>
        </div>
      </div>

      <div className="ngui-stats-row">
        <div className="ngui-stat-card"><div className="ngui-kpi">{totals.buildings}</div><div className="ngui-kpi-label">Total buildings</div></div>
        <div className="ngui-stat-card"><div className="ngui-kpi">{totals.rooms}</div><div className="ngui-kpi-label">Total rooms</div></div>
        <div className="ngui-stat-card"><div className="ngui-kpi">{totals.area.toLocaleString('en-US')} m²</div><div className="ngui-kpi-label">Total area</div></div>
        <div className="ngui-stat-card"><div className="ngui-kpi">{totals.properties}</div><div className="ngui-kpi-label">Properties</div></div>
      </div>

      {favorites.length > 0 && (
        <CarouselRow icon={<Star size={16} style={{ verticalAlign: -2, marginRight: 6 }} />} title="My Favorites" subtitle={`${favorites.length} building(s)`}>
          {favorites.map((b) => <BuildingTile key={b.fmGuid} b={b} />)}
        </CarouselRow>
      )}

      {complexes.map((complex) => {
        const group = filtered.filter((b) => b.complex === complex);
        if (group.length === 0) return null;
        return (
          <CarouselRow key={complex} icon={<Layers size={16} style={{ verticalAlign: -2, marginRight: 6 }} />} title={complex} subtitle={`${group.length} building(s)`}>
            {group.map((b) => <BuildingTile key={b.fmGuid} b={b} />)}
          </CarouselRow>
        );
      })}

      <h3 className="ngui-section-title" style={{ marginTop: 8 }}>All Buildings</h3>
      <div className={listMode ? 'ngui-facility-list' : 'ngui-facility-grid'}>
        {filtered.map((b) => <BuildingTile key={b.fmGuid} b={b} />)}
      </div>
    </>
  );
};

const NewUiPreview: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'home' | 'portfolio'>('home');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');

  return (
    <div className="ngui-root" data-theme={themeMode}>
      <div className="ngui-banner">
        <span>
          🧪 <strong>POC — New Geminus UI</strong> — same content as the real Home and Portfolio pages (live Geminus data), in MD3 design language.
          Color tokens are Faciliate&apos;s real generated tokens (source color #9ED7DF), a temporary stand-in until Geminus has a confirmed logo color.
        </span>
        <span className="ngui-spacer" />
        <button className="ngui-back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={14} />
          Back to current Geminus
        </button>
      </div>

      <div className="ngui-topbar">
        <div className="ngui-logo">G</div>
        <div>
          <div className="ngui-headline">Geminus</div>
          <div className="ngui-subtext">Design language: MD3 tokens (color temporarily borrowed from Faciliate, typography/shape/motion shared across SWG Portfolio)</div>
        </div>
        <div className="ngui-topbar-spacer" />
        <button className="ngui-theme-toggle" onClick={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}>
          {themeMode === 'light' ? <Moon size={14} /> : <SunMedium size={14} />}
          {themeMode === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
      </div>

      <div className="ngui-tabs">
        <button className={`ngui-tab ${tab === 'home' ? 'active' : ''}`} onClick={() => setTab('home')}>
          Home
        </button>
        <button className={`ngui-tab ${tab === 'portfolio' ? 'active' : ''}`} onClick={() => setTab('portfolio')}>
          Portfolio
        </button>
      </div>

      <div className="ngui-content">
        {tab === 'home' ? <HomeTab /> : <PortfolioTab />}

        <div className="ngui-footnote">
          This is a standalone, isolated test page (route: <code>/new-ui-preview</code>) and does not affect the rest of Geminus.
          The &quot;Home&quot; and &quot;Portfolio&quot; tabs read the same live data as the real pages (HomeLanding.tsx / PortfolioView.tsx) via
          AppContext, useAllBuildingSettings and the <code>saved_views</code> table — read-only, nothing here writes to those sources.
          Color, typography, shape and motion tokens are copied verbatim from the real SWG Portfolio MD3 token package
          (@material/material-color-utilities, Faciliate&apos;s confirmed logo color #9ED7DF).
        </div>
      </div>
    </div>
  );
};

export default NewUiPreview;
