import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, ShieldAlert } from 'lucide-react';
import './new-ui-preview.css';

// Static mock data — this page is an isolated visual POC and does not
// read from any live Geminus data source or shared app state.
const MOCK_BUILDINGS = [
  { name: 'Rådhuset', type: 'Kontor', area: '4 200 m²', status: 'ok', sensors: 128 },
  { name: 'Stadsbiblioteket', type: 'Kultur', area: '2 600 m²', status: 'warn', sensors: 64 },
  { name: 'Idrottshallen Vallby', type: 'Idrott', area: '3 100 m²', status: 'ok', sensors: 42 },
  { name: 'Brandstation Norra', type: 'Samhällsfunktion', area: '1 800 m²', status: 'critical', sensors: 51 },
  { name: 'Kommunhuset Östra', type: 'Kontor', area: '5 400 m²', status: 'ok', sensors: 96 },
  { name: 'Simhallen Ekbacken', type: 'Idrott', area: '2 950 m²', status: 'warn', sensors: 38 },
];

const MOCK_ALARMS = [
  { building: 'Brandstation Norra', system: 'Brand', severity: 'critical', status: 'Öppen', time: '08:14' },
  { building: 'Stadsbiblioteket', system: 'Ventilation', severity: 'warn', status: 'Kvitterad', time: '07:52' },
  { building: 'Simhallen Ekbacken', system: 'Hiss', severity: 'warn', status: 'Öppen', time: '07:20' },
  { building: 'Rådhuset', system: 'Inbrott', severity: 'neutral', status: 'Åtgärdad', time: 'Igår' },
  { building: 'Kommunhuset Östra', system: 'Ventilation', severity: 'neutral', status: 'Åtgärdad', time: 'Igår' },
];

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  warn: 'Uppmärksamhet',
  critical: 'Kritisk',
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Kritisk',
  warn: 'Hög',
  neutral: 'Löst',
};

const NewUiPreview: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'portfolio' | 'alarms'>('portfolio');

  return (
    <div className="ngui-root">
      <div className="ngui-banner">
        <span>🧪 <strong>POC — Nya Geminus UI</strong> (Material Design 3-baserat designspråk, se styleguide-underlag)</span>
        <span className="ngui-spacer" />
        <button className="ngui-back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={14} />
          Tillbaka till nuvarande Geminus
        </button>
      </div>

      <div className="ngui-topbar">
        <div className="ngui-logo">G</div>
        <div>
          <div className="ngui-headline">Geminus</div>
          <div className="ngui-subtext">Designspråk: färg/typografi/form genererade från Geminus källfärg</div>
        </div>
      </div>

      <div className="ngui-tabs">
        <button className={`ngui-tab ${tab === 'portfolio' ? 'active' : ''}`} onClick={() => setTab('portfolio')}>
          Portfolio
        </button>
        <button className={`ngui-tab ${tab === 'alarms' ? 'active' : ''}`} onClick={() => setTab('alarms')}>
          Larmhantering
        </button>
      </div>

      <div className="ngui-content">
        {tab === 'portfolio' ? (
          <>
            <h2 className="ngui-section-title"><Building2 size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Fastigheter</h2>
            <p className="ngui-section-desc">Exempel på hur fastighetskort kan se ut med MD3-tokens (form, elevation, tonala ytor).</p>
            <div className="ngui-grid">
              {MOCK_BUILDINGS.map((b) => (
                <div className="ngui-card" key={b.name}>
                  <div className="ngui-card-title">{b.name}</div>
                  <div className="ngui-card-meta">{b.type} · {b.area}</div>
                  <div className="ngui-card-stats">
                    <div>
                      <div className="ngui-kpi">{b.sensors}</div>
                      <div className="ngui-kpi-label">Sensorer</div>
                    </div>
                    <span className={`ngui-chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="ngui-section-title"><ShieldAlert size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Aktiva larm</h2>
            <p className="ngui-section-desc">Exempel på datatät tabellvy med MD3:s tillståndslager (hover) och statuschips.</p>
            <div className="ngui-table-wrap">
              <table className="ngui-table">
                <thead>
                  <tr>
                    <th>Byggnad</th>
                    <th>System</th>
                    <th>Allvarlighet</th>
                    <th>Status</th>
                    <th>Tid</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_ALARMS.map((a, i) => (
                    <tr className="body-row" key={i}>
                      <td>{a.building}</td>
                      <td>{a.system}</td>
                      <td><span className={`ngui-chip ${a.severity}`}>{SEVERITY_LABEL[a.severity]}</span></td>
                      <td>{a.status}</td>
                      <td>{a.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="ngui-btn-filled">Skapa arbetsorder</button>
            </div>
          </>
        )}

        <div className="ngui-footnote">
          Detta är en fristående, isolerad testsida (route: <code>/new-ui-preview</code>) och påverkar inte resten av Geminus.
          Färgtoner är illustrativa placeholders baserade på Geminus nuvarande primärfärg — inte genererade med den riktiga
          HCT-färgmotorn (@material/material-color-utilities). Data på sidan är statisk mockdata, inte live-data.
        </div>
      </div>
    </div>
  );
};

export default NewUiPreview;
