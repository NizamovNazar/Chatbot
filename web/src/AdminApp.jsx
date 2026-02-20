import React, { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

const TABS = [
  { id: 'analytics', label: 'Аналітика' },
  { id: 'updates', label: 'Оновлення даних' },
  { id: 'faq', label: 'Автовідповіді' },
  { id: 'quick', label: 'Швидкі питання' },
];

const ANALYTICS_FILTERS = [
  { id: 'quality', label: 'Якість відповідей' },
  { id: 'model', label: 'Стан моделі та помилки' },
  { id: 'rag', label: 'Пошук по базі знань' },
  { id: 'faq', label: 'Ефективність автовідповідей' },
  { id: 'behavior', label: 'Поведінка користувачів' },
  { id: 'ops', label: 'Стан системи та індексу' },
];
const ANALYTICS_FILTER_IDS = ANALYTICS_FILTERS.map((f) => f.id);
const ANALYTICS_ORDER_KEY = 'adminAnalyticsFilterOrder';
const ANALYTICS_SELECTED_KEY = 'adminAnalyticsSelectedFilter';
const BEHAVIOR_RANGE_OPTIONS = [
  { id: 'daily', label: 'Денний' },
  { id: 'weekly', label: 'Тижневий' },
  { id: 'monthly', label: 'Місячний' },
  { id: 'yearly', label: 'Річний' },
];

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 17.25V21h3.75L17.8 9.95l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l9.06-9.06.92.92L5.92 19.58zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0L15.13 5.1l3.75 3.75 1.83-1.81z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2zm-1 6h2v9H8V9zm6 0h2v9h-2V9zM6 9h2v9H6V9zm1 12h10a2 2 0 0 0 2-2V8H5v11a2 2 0 0 0 2 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconArrowUp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5l6 7h-4v7h-4v-7H6l6-7z" fill="currentColor" />
    </svg>
  );
}

function IconArrowDown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19l-6-7h4V5h4v7h4l-6 7z" fill="currentColor" />
    </svg>
  );
}

function DonutChart({ items, size = 130 }) {
  const total = items.reduce((sum, x) => sum + (Number(x.value) || 0), 0);
  const radius = size / 2;
  const center = size / 2;
  let startAngle = -Math.PI / 2;
  const nonZeroItems = items.filter((x) => (Number(x.value) || 0) > 0);

  if (!total) {
    return <div className="chart-empty">Немає даних для графіка</div>;
  }

  function sectorPath(cx, cy, r, from, to) {
    const x1 = cx + r * Math.cos(from);
    const y1 = cy + r * Math.sin(from);
    const x2 = cx + r * Math.cos(to);
    const y2 = cy + r * Math.sin(to);
    const largeArc = to - from > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  }

  return (
    <div className="chart-wrap donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-chart">
        {nonZeroItems.length === 1 && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill={nonZeroItems[0].color}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="1"
          />
        )}
        {nonZeroItems.length !== 1 && items.map((item) => {
          const value = Number(item.value) || 0;
          if (!value) return null;
          const angle = (value / total) * Math.PI * 2;
          const endAngle = startAngle + angle;
          const d = sectorPath(center, center, radius, startAngle, endAngle);
          startAngle = endAngle;
          return (
            <path
              key={item.label}
              d={d}
              fill={item.color}
              stroke="rgba(255,255,255,0.7)"
              strokeWidth="1"
            />
          );
        })}
      </svg>
      <div className="chart-legend">
        {items.map((item) => (
          <div key={item.label} className="legend-item">
            <span className="legend-dot" style={{ background: item.color }} />
            <span>{item.label}: {item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({ items, color = 'var(--accent)', height = 120, labelKey = 'label', valueKey = 'value' }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [pinnedIdx, setPinnedIdx] = useState(null);
  const points = items.slice(0, 20);
  const width = Math.max(520, points.length * 54 + 120);
  const chartHeight = Math.max(260, height + 120);
  const padLeft = 42;
  const padRight = 18;
  const padTop = 22;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;
  const max = Math.max(1, ...points.map((x) => Number(x[valueKey]) || 0));
  const yTickCount = 5;
  const colW = points.length ? plotW / points.length : plotW;
  const barW = Math.max(8, Math.min(22, colW * 0.44));
  if (!points.length) return <div className="chart-empty">Немає даних для графіка</div>;
  const activeIdx = hoverIdx !== null ? hoverIdx : pinnedIdx;
  const activePoint = activeIdx !== null ? points[activeIdx] : null;

  let overlayHint = null;
  if (activePoint) {
    const idx = activeIdx;
    const val = Number(activePoint[valueKey]) || 0;
    const h = Math.max(2, (val / max) * plotH);
    const x = padLeft + idx * colW + (colW - barW) / 2;
    const y = padTop + plotH - h;
    const cx = x + barW / 2;
    const label = String(activePoint.fullLabel ?? activePoint[labelKey] ?? '').replace(/\s+/g, ' ').trim();
    const tipY = y - 8 < padTop + 10 ? y + 16 : y - 8;
    overlayHint = {
      label,
      leftPct: (cx / width) * 100,
      topPct: (tipY / chartHeight) * 100,
    };
  }

  return (
    <div className="chart-wrap chart-wrap-bar">
      <div className="chart-canvas">
        {overlayHint && (
          <div
            className="chart-float-html"
            style={{ left: `${overlayHint.leftPct}%`, top: `${overlayHint.topPct}%` }}
          >
            {overlayHint.label}
          </div>
        )}
        <svg className="bar-chart-svg" viewBox={`0 0 ${width} ${chartHeight}`} preserveAspectRatio="none">
          <rect x={padLeft} y={padTop} width={plotW} height={plotH} className="chart-area-bg" />
          <line x1={padLeft} y1={padTop + plotH} x2={padLeft + plotW} y2={padTop + plotH} className="chart-axis strong" />
          <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} className="chart-axis strong" />

          {Array.from({ length: yTickCount + 1 }).map((_, i) => {
            const t = i / yTickCount;
            const y = padTop + plotH - t * plotH;
            const v = Math.round(t * max);
            return (
              <g key={`ytick-${i}`}>
                <line x1={padLeft} y1={y} x2={padLeft + plotW} y2={y} className="chart-grid" />
                <text x={padLeft - 8} y={y + 4} textAnchor="end" className="chart-y-text">
                  {v}
                </text>
              </g>
            );
          })}

          {points.map((item, idx) => {
            const val = Number(item[valueKey]) || 0;
            const h = Math.max(2, (val / max) * plotH);
            const x = padLeft + idx * colW + (colW - barW) / 2;
            const y = padTop + plotH - h;
            const cx = x + barW / 2;
            const isHintOpen = activeIdx === idx;
            return (
              <g
                key={`${item[labelKey]}-${idx}`}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx((prev) => (prev === idx ? null : prev))}
                onClick={() => setPinnedIdx((prev) => (prev === idx ? null : idx))}
              >
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="6"
                  className={isHintOpen ? 'bar-rect active' : 'bar-rect'}
                  style={{ fill: color }}
                />
                <text x={cx} y={y - 8} textAnchor="middle" className="chart-bar-value">
                  {val}
                </text>
              </g>
            );
          })}

        </svg>
      </div>
    </div>
  );
}

function MultiLineChart({ items, height = 460, xAxisLabel = 'Час', yAxisLabel = 'Кількість' }) {
  if (!items.length) return <div className="chart-empty">Немає даних для графіка</div>;

  const source = items;
  const hasNonZero = source.some((p) => (Number(p.ua) || 0) > 0 || (Number(p.en) || 0) > 0);
  if (!hasNonZero) return <div className="chart-empty">Немає ненульових даних для графіка</div>;

  const width = Math.max(680, source.length * 48 + 120);
  const chartHeight = Math.max(height, 460);
  const padLeft = 62;
  const padRight = 88;
  const padTop = 18;
  const padBottom = source.length > 16 ? 72 : 48;
  const plotW = width - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;
  const maxYRaw = Math.max(1, ...source.flatMap((p) => [Number(p.ua) || 0, Number(p.en) || 0]));
  const yStep = maxYRaw <= 10 ? 1 : 2;
  const yMax = Math.max(yStep, Math.ceil(maxYRaw / yStep) * yStep);
  const yTickCount = Math.floor(yMax / yStep);
  const xStep = plotW / (source.length + 1);
  const xLabelStep = source.length > 24 ? 3 : source.length > 14 ? 2 : 1;
  const rotateX = false;

  const uaHasData = source.some((p) => (Number(p.ua) || 0) > 0);
  const enHasData = source.some((p) => (Number(p.en) || 0) > 0);

  const uaPts = source.map((p, idx) => ({
    x: padLeft + (idx + 1) * xStep,
    y: padTop + plotH - ((Number(p.ua) || 0) / yMax) * plotH,
  }));
  const enPts = source.map((p, idx) => ({
    x: padLeft + (idx + 1) * xStep,
    y: padTop + plotH - ((Number(p.en) || 0) / yMax) * plotH,
  }));

  const uaPolyline = uaPts.map((p) => `${p.x},${p.y}`).join(' ');
  const enPolyline = enPts.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="chart-wrap">
      <svg className="line-chart multi-line-chart" viewBox={`0 0 ${width} ${chartHeight}`} preserveAspectRatio="none">
        <rect x={padLeft} y={padTop} width={plotW} height={plotH} className="chart-area-bg" />
        <line x1={padLeft} y1={padTop + plotH} x2={width - padRight} y2={padTop + plotH} className="chart-axis strong" />
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} className="chart-axis strong" />

        {Array.from({ length: yTickCount + 1 }).map((_, i) => {
          const value = i * yStep;
          const y = padTop + plotH - (value / yMax) * plotH;
          return (
            <g key={`yg-${i}`}>
              {value > 0 ? <line x1={padLeft} y1={y} x2={width - padRight} y2={y} className="chart-grid" /> : null}
              {value > 0 ? (
                <text x={padLeft - 8} y={y + 4} textAnchor="end" className="chart-y-text">
                  {value}
                </text>
              ) : null}
            </g>
          );
        })}

        {source.map((p, idx) => {
          const x = padLeft + (idx + 1) * xStep;
          return (
            <g key={`xg-${idx}`}>
              <line x1={x} y1={padTop + plotH} x2={x} y2={padTop + plotH + 6} className="chart-axis" />
              {idx % xLabelStep === 0 ? (
                <text
                  x={x}
                  y={padTop + plotH + (rotateX ? 26 : 18)}
                  textAnchor={rotateX ? 'end' : 'middle'}
                  transform={rotateX ? `rotate(-45 ${x} ${padTop + plotH + 26})` : undefined}
                  className="chart-x-text"
                >
                  {String(p.label || '')}
                </text>
              ) : null}
            </g>
          );
        })}

        {uaHasData && uaPts.length > 1 && <polyline points={uaPolyline} fill="none" className="chart-line chart-line-orange" />}
        {enHasData && enPts.length > 1 && <polyline points={enPolyline} fill="none" className="chart-line chart-line-turquoise" />}

        {uaHasData && uaPts.map((p, idx) => (
          <circle key={`ua-${idx}`} cx={p.x} cy={p.y} r="3" className="chart-point chart-point-orange" />
        ))}
        {enHasData && enPts.map((p, idx) => (
          <circle key={`en-${idx}`} cx={p.x} cy={p.y} r="3" className="chart-point chart-point-turquoise" />
        ))}

        <text
          x={width - padRight + 8}
          y={padTop + plotH - 4}
          textAnchor="start"
          dominantBaseline="middle"
          className="chart-axis-title"
        >
          {xAxisLabel}
        </text>
        <text
          x={padLeft}
          y={padTop - 10}
          textAnchor="middle"
          className="chart-axis-title"
        >
          {yAxisLabel}
        </text>
      </svg>
    </div>
  );
}

export default function AdminApp() {
  const [theme, setTheme] = useState(() => localStorage.getItem('adminTheme') || 'dark');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [stats, setStats] = useState(null);
  const [qa, setQa] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [quickItems, setQuickItems] = useState([]);
  const [quickDraft, setQuickDraft] = useState('');
  const [quickSuggestions, setQuickSuggestions] = useState([]);
  const [contentLang, setContentLang] = useState('uk');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsFilterOrder, setAnalyticsFilterOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ANALYTICS_ORDER_KEY) || '[]');
      const kept = Array.isArray(saved) ? saved.filter((id) => ANALYTICS_FILTER_IDS.includes(id)) : [];
      const missing = ANALYTICS_FILTER_IDS.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    } catch {
      return ANALYTICS_FILTER_IDS;
    }
  });
  const [analyticsFilters, setAnalyticsFilters] = useState(() => {
    const saved = localStorage.getItem(ANALYTICS_SELECTED_KEY);
    if (saved && ANALYTICS_FILTER_IDS.includes(saved)) return [saved];
    return [ANALYTICS_FILTER_IDS[0]];
  });
  const [dragFilterId, setDragFilterId] = useState(null);
  const [feedbackFilter, setFeedbackFilter] = useState('all');
  const [behaviorRange, setBehaviorRange] = useState('weekly');
  const [behaviorPeriod, setBehaviorPeriod] = useState('');
  const [behaviorAmountMode, setBehaviorAmountMode] = useState('requests');
  const [behaviorPickerOpen, setBehaviorPickerOpen] = useState(false);
  const [behaviorPickerView, setBehaviorPickerView] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    return { year: y, month: now.getMonth() + 1, decadeStart: Math.floor(y / 10) * 10 };
  });
  const behaviorPickerRef = useRef(null);
  const [filterClearPulse, setFilterClearPulse] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetModalClosing, setResetModalClosing] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('analytics');
  const [reindexing, setReindexing] = useState(false);
  const [reindexStatus, setReindexStatus] = useState('');
  const [progress, setProgress] = useState({ indexed: 0, seen: 0, queued: 0 });
  const [lastIndexedAt, setLastIndexedAt] = useState(null);
  const [lastIndexedCount, setLastIndexedCount] = useState(null);
  const [scheduleHour, setScheduleHour] = useState(2);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [systemStatus, setSystemStatus] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const tabIndex = useMemo(() => TABS.findIndex((t) => t.id === activeTab), [activeTab]);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('adminTheme', theme);
  }, [theme]);

  useEffect(() => {
    setAnalyticsFilters((prev) => {
      const cleaned = prev.filter((id) => ANALYTICS_FILTER_IDS.includes(id));
      if (cleaned.length) return [cleaned[0]];
      return [ANALYTICS_FILTER_IDS[0]];
    });
    setAnalyticsFilterOrder((prev) => {
      const kept = prev.filter((id) => ANALYTICS_FILTER_IDS.includes(id));
      const missing = ANALYTICS_FILTER_IDS.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(ANALYTICS_ORDER_KEY, JSON.stringify(analyticsFilterOrder));
  }, [analyticsFilterOrder]);

  useEffect(() => {
    if (!analyticsFilters.length) return;
    localStorage.setItem(ANALYTICS_SELECTED_KEY, analyticsFilters[0]);
  }, [analyticsFilters]);

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  async function login() {
    const res = await fetch(`${apiBase}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoggedIn(!!data.ok);
  }

  async function loadStats() {
    try {
      const res = await fetch(`${apiBase}/api/admin/stats`);
      const data = await res.json();
      setStats(data);
    } catch {
      setErrorMsg('Не вдалося підключитися до сервера (бекенд вимкнено).');
    }
  }

  async function loadQa() {
    try {
      const res = await fetch(`${apiBase}/api/admin/qa?lang=${contentLang}`);
      const data = await res.json();
      setQa(data);
    } catch {
      setErrorMsg('Не вдалося підключитися до сервера (бекенд вимкнено).');
    }
  }

  async function loadQuick() {
    try {
      const res = await fetch(`${apiBase}/api/admin/quick?lang=${contentLang}`);
      const data = await res.json();
      setQuickItems(Array.isArray(data) ? data : []);
    } catch {
      setErrorMsg('Не вдалося отримати швидкі питання.');
    }
  }

  async function loadQuickSuggestions() {
    try {
      const res = await fetch(`${apiBase}/api/admin/quick/suggestions?lang=${contentLang}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('quick_suggestions_failed');
      setQuickSuggestions(Array.isArray(data.items) ? data.items : []);
    } catch {
      setQuickSuggestions([]);
    }
  }

  async function loadAnalytics() {
    try {
      const res = await fetch(`${apiBase}/api/admin/analytics`);
      const data = await res.json();
      if (!data.ok) return;
      setAnalyticsData(data);
    } catch {
      setErrorMsg('Не вдалося завантажити аналітику.');
    }
  }

  async function saveQuick(items) {
    const deduped = Array.from(new Set(items.map((x) => String(x).trim()).filter(Boolean)));
    setQuickItems(deduped);
    try {
      await fetch(`${apiBase}/api/admin/quick`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: deduped, lang: contentLang }),
      });
      loadQuickSuggestions();
    } catch {
      setErrorMsg('Не вдалося зберегти швидкі питання.');
    }
  }

  async function createQa() {
    try {
      await fetch(`${apiBase}/api/admin/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer, lang: contentLang }),
      });
      setQuestion('');
      setAnswer('');
      setEditingId(null);
      loadQa();
    } catch {
      setErrorMsg('Не вдалося зберегти FAQ. Перевір, що бекенд запущено.');
    }
  }

  async function updateQa(item, enabled) {
    try {
      await fetch(`${apiBase}/api/admin/qa/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: item.question,
          answer: item.answer,
          lang: contentLang,
          enabled,
        }),
      });
      loadQa();
    } catch {
      setErrorMsg('Не вдалося оновити FAQ. Перевір, що бекенд запущено.');
    }
  }

  async function saveQa() {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) return;
    if (editingId) {
      const item = qa.find((x) => x.id === editingId);
      if (!item) return;
      await updateQa({ ...item, question: q, answer: a }, true);
      setEditingId(null);
      setQuestion('');
      setAnswer('');
      return;
    }
    await createQa();
  }

  async function deleteQa(id) {
    try {
      await fetch(`${apiBase}/api/admin/qa/${id}`, { method: 'DELETE' });
      loadQa();
    } catch {
      setErrorMsg('Не вдалося видалити FAQ. Перевір, що бекенд запущено.');
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setQuestion(item.question || '');
    setAnswer(item.answer || '');
  }

  async function loadReindexStatus() {
    try {
      const res = await fetch(`${apiBase}/api/admin/reindex/status`);
      const data = await res.json();
      if (!data.ok) return;
      setReindexing(data.status === 'running');
      setProgress({
        indexed: data.indexed || 0,
        seen: data.seen || 0,
        queued: data.queued || 0,
      });
      setLastIndexedAt(data.lastIndexedAt);
      setLastIndexedCount(data.lastIndexedCount);
    } catch {
      setErrorMsg('Не вдалося отримати статус оновлення.');
    }
  }

  async function loadSystemStatus() {
    try {
      const res = await fetch(`${apiBase}/api/admin/system-status`);
      const data = await res.json();
      if (!data.ok) return;
      setSystemStatus(data);
    } catch {
      setErrorMsg('Не вдалося отримати стан чату та моделі.');
    }
  }

  async function loadSchedule() {
    try {
      const res = await fetch(`${apiBase}/api/admin/reindex/schedule`);
      const data = await res.json();
      if (!data.ok) return;
      setScheduleHour(Number(data.hour) || 0);
      setScheduleMinute(Number(data.minute) || 0);
    } catch {
      setErrorMsg('Не вдалося отримати час автооновлення.');
    }
  }

  async function saveSchedule(hour, minute) {
    try {
      const res = await fetch(`${apiBase}/api/admin/reindex/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hour, minute }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('schedule_failed');
    } catch {
      setErrorMsg('Не вдалося зберегти час автооновлення.');
    }
  }

  async function startReindex() {
    setReindexing(true);
    setReindexStatus('');
    try {
      const res = await fetch(`${apiBase}/api/admin/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('Не вдалося запустити оновлення');
      setReindexStatus(data.status === 'running' ? 'Оновлення вже виконується' : 'Оновлення запущено');
      loadReindexStatus();
    } catch {
      setReindexStatus('Помилка запуску оновлення');
    } finally {
      setReindexing(false);
    }
  }

  useEffect(() => {
    if (loggedIn) {
      loadStats();
      loadQa();
      loadReindexStatus();
      loadQuick();
      loadQuickSuggestions();
      loadSystemStatus();
      loadAnalytics();
      loadSchedule();
    }
  }, [loggedIn, contentLang]);

  useEffect(() => {
    setQuestion('');
    setAnswer('');
    setEditingId(null);
    setQuickDraft('');
  }, [contentLang]);

  useEffect(() => {
    if (!loggedIn || activeTab !== 'updates') return;
    const timer = setInterval(() => {
      loadReindexStatus();
      loadSystemStatus();
    }, 2000);
    return () => clearInterval(timer);
  }, [loggedIn, activeTab]);

  useEffect(() => {
    if (!loggedIn || activeTab !== 'analytics') return;
    const timer = setInterval(() => {
      loadAnalytics();
    }, 5000);
    return () => clearInterval(timer);
  }, [loggedIn, activeTab]);

  function Logo() {
    const [failed, setFailed] = useState(false);
    if (failed) return <div className="logo-text">ОА</div>;
    return (
      <div className="logo-lockup">
        <img
          className="logo-img"
          src="/oa-logo.png"
          alt="Національний університет «Острозька академія»"
          onError={() => setFailed(true)}
        />
        <div className="logo-copy">
          <div className="logo-sub">Національний університет</div>
          <div className="logo-title">Острозька Академія</div>
        </div>
      </div>
    );
  }

  function shouldShow(id) {
    return analyticsFilters.includes(id);
  }

  const activeAnalyticsIds = analyticsFilters;
  const singleAnalyticsMode = activeAnalyticsIds.length === 1;
  const allFiltersSelected = false;
  const analyticsFilterMap = useMemo(
    () => new Map(ANALYTICS_FILTERS.map((f) => [f.id, f])),
    []
  );
  const orderedAnalyticsFilters = analyticsFilterOrder
    .map((id) => analyticsFilterMap.get(id))
    .filter(Boolean);

  function toggleAnalyticsFilter(id) {
    setAnalyticsFilters([id]);
  }

  function clearAnalyticsFilters() {
    setAnalyticsFilters([analyticsFilterOrder[0] || ANALYTICS_FILTER_IDS[0]]);
    setFilterClearPulse(true);
  }

  function handleFilterDragStart(id) {
    setDragFilterId(id);
  }

  function handleFilterDrop(targetId) {
    if (!dragFilterId || dragFilterId === targetId) {
      setDragFilterId(null);
      return;
    }
    setAnalyticsFilterOrder((prev) => {
      const from = prev.indexOf(dragFilterId);
      const to = prev.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragFilterId(null);
  }

  async function resetAnalyticsStats() {
    if (!resetEmail.trim() || !resetPassword.trim()) return;
    try {
      const res = await fetch(`${apiBase}/api/admin/analytics/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim(), password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('reset_failed');
      closeResetModal(true);
      loadAnalytics();
      loadStats();
      loadSystemStatus();
    } catch {
      setErrorMsg('Не вдалося скинути статистику.');
    }
  }

  function closeResetModal(clearFields = false) {
    setResetModalClosing(true);
    window.setTimeout(() => {
      setShowResetModal(false);
      setResetModalClosing(false);
      if (clearFields) {
        setResetEmail('');
        setResetPassword('');
      }
    }, 260);
  }

  const behaviorTopQuestions = analyticsData?.behavior?.topQuestions || [];
  const behaviorSelectable = analyticsData?.behavior?.byLanguageSelectable || {};
  const behaviorRangeOptions = behaviorSelectable.options?.[behaviorRange] || [];
  const behaviorRangeDefaults = behaviorSelectable.defaults || {};
  const monthNamesUa = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const weekDaysUa = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

  useEffect(() => {
    if (!behaviorRangeOptions.length) {
      setBehaviorPeriod('');
      return;
    }
    const rangeDefault = behaviorRangeDefaults?.[behaviorRange] || behaviorRangeOptions[behaviorRangeOptions.length - 1];
    setBehaviorPeriod((prev) => (behaviorRangeOptions.includes(prev) ? prev : rangeDefault));
  }, [behaviorRange, analyticsData]);

  useEffect(() => {
    if (!behaviorPeriod) return;
    if (behaviorRange === 'yearly') {
      const year = Number(behaviorPeriod);
      if (!Number.isNaN(year)) {
        setBehaviorPickerView((v) => ({ ...v, year, decadeStart: Math.floor(year / 10) * 10 }));
      }
      return;
    }
    if (behaviorRange === 'monthly' || behaviorRange === 'daily') {
      const [y, m] = String(behaviorPeriod).split('-').map(Number);
      if (!Number.isNaN(y) && !Number.isNaN(m)) {
        setBehaviorPickerView((v) => ({ ...v, year: y, month: m }));
      }
      return;
    }
    if (behaviorRange === 'weekly') {
      const [y, m] = String(behaviorPeriod).split('-').map(Number);
      if (!Number.isNaN(y) && !Number.isNaN(m)) {
        setBehaviorPickerView((v) => ({ ...v, year: y, month: m }));
      }
    }
  }, [behaviorRange, behaviorPeriod]);

  useEffect(() => {
    function onDocClick(e) {
      if (!behaviorPickerOpen) return;
      if (behaviorPickerRef.current && !behaviorPickerRef.current.contains(e.target)) {
        setBehaviorPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [behaviorPickerOpen]);

  const rawBehaviorSeries =
    (behaviorPeriod && behaviorSelectable.series?.[behaviorRange]?.[behaviorPeriod]) ||
    analyticsData?.behavior?.byLanguageRange?.[behaviorRange] ||
    (analyticsData?.behavior?.requestsByDay || []).map((x) => ({
      label: x.day?.slice(5) || '',
      uaReq: x.count || 0,
      enReq: 0,
      uaUsers: 0,
      enUsers: 0,
    }));
  const behaviorSeries = rawBehaviorSeries
    .map((p) => ({
      label: p.label,
      ua: behaviorAmountMode === 'users' ? Number(p.uaUsers || 0) : Number(p.uaReq || 0),
      en: behaviorAmountMode === 'users' ? Number(p.enUsers || 0) : Number(p.enReq || 0),
    }))
    .sort((a, b) => {
      const la = String(a.label || '');
      const lb = String(b.label || '');

      if (behaviorRange === 'daily') {
        const parse = (value) => {
          const m = value.match(/^(\d{1,2}):(\d{2})$/);
          if (!m) return Number.MAX_SAFE_INTEGER;
          return Number(m[1]) * 60 + Number(m[2]);
        };
        return parse(la) - parse(lb);
      }

      if (behaviorRange === 'weekly') {
        const idxA = weekDaysUa.findIndex((d) => d.toLowerCase() === la.toLowerCase());
        const idxB = weekDaysUa.findIndex((d) => d.toLowerCase() === lb.toLowerCase());
        const safeA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
        const safeB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
        if (safeA !== safeB) return safeA - safeB;
        return la.localeCompare(lb, 'uk');
      }

      if (behaviorRange === 'monthly') {
        const da = Number(la);
        const db = Number(lb);
        const safeA = Number.isFinite(da) ? da : Number.MAX_SAFE_INTEGER;
        const safeB = Number.isFinite(db) ? db : Number.MAX_SAFE_INTEGER;
        if (safeA !== safeB) return safeA - safeB;
        return la.localeCompare(lb, 'uk');
      }

      if (behaviorRange === 'yearly') {
        const idxA = monthNamesUa.findIndex((m) => m.toLowerCase() === la.toLowerCase());
        const idxB = monthNamesUa.findIndex((m) => m.toLowerCase() === lb.toLowerCase());
        const safeA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
        const safeB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
        if (safeA !== safeB) return safeA - safeB;
        return la.localeCompare(lb, 'uk');
      }

      return la.localeCompare(lb, 'uk');
    });

  function formatBehaviorPeriodLabel(range, value) {
    if (!value) return '—';
    if (range === 'daily') return value;
    if (range === 'weekly') {
      const dt = new Date(`${value}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return value;
      const end = new Date(dt);
      end.setDate(dt.getDate() + 6);
      const f = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      return `${f(dt)} - ${f(end)}`;
    }
    if (range === 'monthly') {
      const [y, m] = value.split('-');
      return `${m}.${y}`;
    }
    return value;
  }
  const behaviorXAxisLabel =
    behaviorRange === 'daily'
      ? 'Години'
      : behaviorRange === 'yearly'
        ? 'Місяці'
        : 'Дні';
  const behaviorYAxisLabel = behaviorAmountMode === 'users' ? 'Користувачі' : 'Запити';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function buildDateKey(y, m, d) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function renderBehaviorPeriodMenu() {
    if (!behaviorPickerOpen) return null;

    if (behaviorRange === 'yearly') {
      const start = behaviorPickerView.decadeStart;
      const years = Array.from({ length: 12 }).map((_, i) => start - 1 + i);
      const optionsSet = new Set(behaviorRangeOptions.map((x) => Number(x)));
      return (
        <div className="behavior-picker-panel">
          <div className="behavior-picker-head">
            <strong>{start} - {start + 9}</strong>
            <div className="behavior-picker-nav">
              <button onClick={() => setBehaviorPickerView((v) => ({ ...v, decadeStart: v.decadeStart - 10 }))}>
                <span className="nav-triangle">▲</span>
              </button>
              <button onClick={() => setBehaviorPickerView((v) => ({ ...v, decadeStart: v.decadeStart + 10 }))}>
                <span className="nav-triangle">▼</span>
              </button>
            </div>
          </div>
          <div className="behavior-grid behavior-grid-years">
            {years.map((y) => {
              const enabled = optionsSet.has(y);
              return (
                <button
                  key={y}
                  className={behaviorPeriod === String(y) ? 'period-cell active' : 'period-cell'}
                  disabled={!enabled}
                  onClick={() => {
                    setBehaviorPeriod(String(y));
                    setBehaviorPickerOpen(false);
                  }}
                >
                  {y}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (behaviorRange === 'monthly') {
      const y = behaviorPickerView.year;
      const optionsSet = new Set(behaviorRangeOptions);
      return (
        <div className="behavior-picker-panel">
          <div className="behavior-picker-head">
            <strong>{y} р.</strong>
            <div className="behavior-picker-nav">
              <button onClick={() => setBehaviorPickerView((v) => ({ ...v, year: v.year - 1 }))}>
                <span className="nav-triangle">▲</span>
              </button>
              <button onClick={() => setBehaviorPickerView((v) => ({ ...v, year: v.year + 1 }))}>
                <span className="nav-triangle">▼</span>
              </button>
            </div>
          </div>
          <div className="behavior-grid behavior-grid-months">
            {monthNamesUa.map((m, idx) => {
              const key = `${y}-${pad2(idx + 1)}`;
              const enabled = optionsSet.has(key);
              return (
                <button
                  key={key}
                  className={behaviorPeriod === key ? 'period-cell active' : 'period-cell'}
                  disabled={!enabled}
                  onClick={() => {
                    setBehaviorPeriod(key);
                    setBehaviorPickerOpen(false);
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (behaviorRange === 'weekly') {
      const y = behaviorPickerView.year;
      const m = behaviorPickerView.month;
      const optionsSet = new Set(behaviorRangeOptions);

      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0);
      const firstWeekStart = new Date(monthStart);
      const startWeekDay = (firstWeekStart.getDay() || 7) - 1; // Mon=0
      firstWeekStart.setDate(firstWeekStart.getDate() - startWeekDay);

      const weeks = [];
      let cursor = new Date(firstWeekStart);
      while (cursor <= monthEnd || cursor.getMonth() === monthStart.getMonth()) {
        const weekStart = new Date(cursor);
        const weekKey = buildDateKey(weekStart.getFullYear(), weekStart.getMonth() + 1, weekStart.getDate());
        const days = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          return d;
        });
        weeks.push({ weekKey, days });
        cursor.setDate(cursor.getDate() + 7);
        if (weeks.length > 8) break;
      }

      return (
        <div className="behavior-picker-panel">
          <div className="behavior-picker-head">
            <strong>{monthNamesUa[m - 1]} {y} р.</strong>
            <div className="behavior-picker-nav">
              <button
                onClick={() => {
                  const prev = new Date(y, m - 2, 1);
                  setBehaviorPickerView((v) => ({ ...v, year: prev.getFullYear(), month: prev.getMonth() + 1 }));
                }}
              >
                <span className="nav-triangle">▲</span>
              </button>
              <button
                onClick={() => {
                  const next = new Date(y, m, 1);
                  setBehaviorPickerView((v) => ({ ...v, year: next.getFullYear(), month: next.getMonth() + 1 }));
                }}
              >
                <span className="nav-triangle">▼</span>
              </button>
            </div>
          </div>
          <div className="behavior-weekdays behavior-weekdays-with-index">
            <span className="week-index-head">№</span>
            {weekDaysUa.map((w) => <span key={w}>{w}</span>)}
          </div>
          <div className="behavior-grid behavior-grid-weeks-calendar">
            {weeks.map((w, idx) => {
              const enabled = optionsSet.has(w.weekKey);
              return (
                <React.Fragment key={w.weekKey}>
                  <button
                    className={behaviorPeriod === w.weekKey ? 'week-index-btn active' : 'week-index-btn'}
                    disabled={!enabled}
                    onClick={() => {
                      setBehaviorPeriod(w.weekKey);
                      setBehaviorPickerOpen(false);
                    }}
                  >
                    {idx + 1}
                  </button>
                  {w.days.map((d) => {
                    const isOutside = d.getMonth() !== m - 1;
                    return (
                      <span
                        key={`${w.weekKey}-${d.toISOString()}`}
                        className={isOutside ? 'week-day-cell outside' : 'week-day-cell'}
                      >
                        {d.getDate()}
                      </span>
                    );
                  })}
                </React.Fragment>
              );
            })}
            {!weeks.length && <div className="period-empty">Немає даних</div>}
          </div>
        </div>
      );
    }

    const y = behaviorPickerView.year;
    const m = behaviorPickerView.month;
    const optionsSet = new Set(behaviorRangeOptions);
    const first = new Date(y, m - 1, 1);
    const startWeekDay = ((first.getDay() || 7) - 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startWeekDay; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
    return (
      <div className="behavior-picker-panel">
        <div className="behavior-picker-head">
          <strong>{monthNamesUa[m - 1]} {y} р.</strong>
          <div className="behavior-picker-nav">
            <button
              onClick={() => {
                const prev = new Date(y, m - 2, 1);
                setBehaviorPickerView((v) => ({ ...v, year: prev.getFullYear(), month: prev.getMonth() + 1 }));
              }}
            >
              <span className="nav-triangle">▲</span>
            </button>
            <button
              onClick={() => {
                const next = new Date(y, m, 1);
                setBehaviorPickerView((v) => ({ ...v, year: next.getFullYear(), month: next.getMonth() + 1 }));
              }}
            >
              <span className="nav-triangle">▼</span>
            </button>
          </div>
        </div>
        <div className="behavior-weekdays">
          {weekDaysUa.map((w) => <span key={w}>{w}</span>)}
        </div>
        <div className="behavior-grid behavior-grid-days">
          {cells.map((d, idx) => {
            if (!d) return <span key={`empty-${idx}`} className="period-cell empty" />;
            const key = buildDateKey(y, m, d);
            const enabled = optionsSet.has(key);
            return (
              <button
                key={key}
                className={behaviorPeriod === key ? 'period-cell active' : 'period-cell'}
                disabled={!enabled}
                onClick={() => {
                  setBehaviorPeriod(key);
                  setBehaviorPickerOpen(false);
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  const isUkQuery = (q) => /[А-Яа-яІіЇїЄєҐґ]/.test(String(q || ''));
  const behaviorUkQueries = behaviorTopQuestions.filter((x) => isUkQuery(x.question)).slice(0, 8);
  const behaviorEnQueries = behaviorTopQuestions
    .filter((x) => !isUkQuery(x.question) && /[A-Za-z]/.test(String(x.question || '')))
    .slice(0, 8);

  if (!loggedIn) {
    return (
      <div className="app">
        <div className="bg-shape one" />
        <div className="bg-shape two" />
        <header className="topbar">
          <Logo />
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? 'Світла тема' : 'Темна тема'}
          </button>
        </header>
        <main>
          <div className="panel auth-panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Панель керування</div>
                <h1>Вхід адміністратора</h1>
                <p className="muted">Введи логін і пароль для доступу до керування.</p>
              </div>
            </div>
            <div className="form-grid auth-form">
              <input className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
              <input
                className="auth-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
              />
              <button onClick={login}>Увійти</button>
            </div>
          </div>
        </main>
        <footer className="footer">Острозька академія • Панель керування</footer>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="bg-shape one" />
      <div className="bg-shape two" />
      <header className="topbar">
        <Logo />
        <div className="topbar-title">Панель керування</div>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? 'Світла тема' : 'Темна тема'}
        </button>
      </header>
      <main>
        <div className="panel admin-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Адміністративний центр</div>
              <h1>Контроль якості та контенту</h1>
              <p className="muted">Аналітика, оновлення даних і керування автовідповідями.</p>
            </div>
          </div>

          <div className="tab-bar">
            <div className="tab-indicator" style={{ transform: `translateX(${tabIndex * 100}%)` }} />
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={tab.id === activeTab ? 'tab active' : 'tab'}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'analytics' && (
            <section className="tab-section">
              <div className={filtersCollapsed ? 'analytics-layout filters-collapsed' : 'analytics-layout'}>
                <div className="filters-toolbar-line">
                  <button
                    type="button"
                    className="filter-collapse"
                    title={filtersCollapsed ? 'Розгорнути фільтри' : 'Згорнути фільтри'}
                    onClick={() => setFiltersCollapsed((v) => !v)}
                  >
                    <span className="filter-collapse-icon">{'<<'}</span>
                    <span className="filter-collapse-label">
                      {filtersCollapsed ? 'Розгорнути фільтри' : 'Згорнути фільтри'}
                    </span>
                  </button>
                  <div className="analytics-detail-hint">Для детальнішого перегляду відкрий потрібний фільтр</div>
                  <button
                    type="button"
                    className="analytics-reset-btn"
                    title="Скинути статистику"
                    onClick={() => {
                      setShowResetModal(true);
                      setResetModalClosing(false);
                    }}
                  >
                    Скинути статистику
                  </button>
                </div>
                <aside className={filtersCollapsed ? 'analytics-filters collapsed' : 'analytics-filters'}>
                  {orderedAnalyticsFilters.map((f) => (
                    <label
                      key={f.id}
                      title={f.label}
                      className={[
                        analyticsFilters.includes(f.id) ? 'filter-radio active' : 'filter-radio',
                        dragFilterId === f.id ? 'dragging' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      draggable
                      onDragStart={() => handleFilterDragStart(f.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleFilterDrop(f.id)}
                      onDragEnd={() => setDragFilterId(null)}
                    >
                      <input
                        type="checkbox"
                        checked={analyticsFilters.includes(f.id)}
                        onChange={() => toggleAnalyticsFilter(f.id)}
                      />
                      <span className="filter-dot" />
                      <span className="filter-label">{f.label}</span>
                    </label>
                  ))}
                  {/* кнопка "прибрати фільтри", можливо потім знадобиться
                  <button
                    className={filterClearPulse ? 'filter-clear pulse' : 'filter-clear'}
                    onClick={clearAnalyticsFilters}
                  >
                    <span className="filter-clear-icon">?</span>
                    <span className="filter-clear-label">Прибрати фільтри</span>
                  </button>
                  */}
                </aside>

                <div
                  className={[
                    'analytics-content',
                    singleAnalyticsMode ? 'single-filter-view' : '',
                    allFiltersSelected ? 'all-filters-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="stats-grid">
                    {shouldShow('quality') && (
                      <div className="stat metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Якість відповідей</div>
                          <div className="stat-list">Запитів у логах: {analyticsData?.quality?.total ?? 0}</div>
                          <div className="stat-list">Без знайденого контексту: {analyticsData?.quality?.noContext ?? 0}</div>
                          <div className="stat-list">Відповідей-заглушок: {analyticsData?.quality?.fallback ?? 0}</div>
                        </div>
                        <div className="chart-group">
                          <DonutChart
                            items={[
                              {
                                label: 'Якісні відповіді',
                                value: Math.max(
                                  0,
                                  (analyticsData?.quality?.total ?? 0) -
                                    (analyticsData?.quality?.noContext ?? 0) -
                                    (analyticsData?.quality?.fallback ?? 0)
                                ),
                                color: '#22c55e',
                              },
                              { label: 'Без контексту', value: analyticsData?.quality?.noContext ?? 0, color: '#f59e0b' },
                              { label: 'Заглушки', value: analyticsData?.quality?.fallback ?? 0, color: '#ef4444' },
                            ]}
                          />
                        </div>
                      </div>
                    )}
                    {shouldShow('model') && (
                      <div className="stat metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Стан моделі та помилки</div>
                          <div className="stat-list">Успішних відповідей моделі: {analyticsData?.model?.success ?? 0}</div>
                          <div className="stat-list">Помилок моделі: {analyticsData?.model?.errors ?? 0}</div>
                          <div className="stat-list">
                            Типовий / піковий час відповіді: {analyticsData?.model?.latencyP50 ?? 0} / {analyticsData?.model?.latencyP95 ?? 0} мс
                          </div>
                        </div>
                        <div className="chart-group">
                          <DonutChart
                            items={[
                              { label: 'Успішно', value: analyticsData?.model?.success ?? 0, color: '#22c55e' },
                              { label: 'Помилки', value: analyticsData?.model?.errors ?? 0, color: '#ef4444' },
                            ]}
                          />
                        </div>
                      </div>
                    )}
                    {shouldShow('rag') && (
                      <div className="stat metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Пошук по базі знань</div>
                          <div className="stat-list">Середня кількість знайдених фрагментів: {analyticsData?.rag?.avgContexts ?? 0}</div>
                          <div className="stat-list">Запитів без результатів пошуку: {(analyticsData?.rag?.emptySearches || []).length}</div>
                          <div className="stat-list">Унікальних активних джерел: {(analyticsData?.rag?.topSources || []).length}</div>
                        </div>
                        <div className="chart-group bar-group">
                          <BarChart
                            items={(analyticsData?.rag?.topSources || []).slice(0, 6).map((x) => ({
                              label: String(x.source || '') || 'Джерело',
                              fullLabel: String(x.source || '') || 'Джерело',
                              value: x.count || 0,
                            }))}
                          />
                        </div>
                      </div>
                    )}
                    {shouldShow('faq') && (
                      <div className="stat metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Ефективність автовідповідей</div>
                          <div className="stat-list">Відповідей із автовідповідей: {analyticsData?.faq?.faqResponses ?? 0}</div>
                          <div className="stat-list">Відповідей через модель: {analyticsData?.faq?.llmResponses ?? 0}</div>
                          <div className="stat-list">Відповідей із помилкою: {analyticsData?.faq?.errorResponses ?? 0}</div>
                        </div>
                        <div className="chart-group">
                          <DonutChart
                            items={[
                              { label: 'Автовідповіді', value: analyticsData?.faq?.faqResponses ?? 0, color: '#0ea5e9' },
                              { label: 'Модель', value: analyticsData?.faq?.llmResponses ?? 0, color: '#22c55e' },
                              { label: 'Помилка', value: analyticsData?.faq?.errorResponses ?? 0, color: '#ef4444' },
                            ]}
                          />
                        </div>
                      </div>
                    )}
                    {shouldShow('behavior') && (
                      <div className="stat behavior-top-card">
                        <div className="behavior-top-title">Найчастіші запити користувачів</div>
                        <div className="behavior-top-divider" />
                        <div className="behavior-top-split">
                          <div className="behavior-col">
                            <div className="behavior-col-title">Україномовні запити</div>
                            <div className="stat-list">
                              {behaviorUkQueries.length === 0 && <div>Немає даних</div>}
                              {behaviorUkQueries.map((x, i) => (
                                <div key={`uk-${i}`}>{x.count} × {x.question}</div>
                              ))}
                            </div>
                          </div>
                          <div className="behavior-col behavior-col-en">
                            <div className="behavior-col-title">Англомовні запити</div>
                            <div className="stat-list">
                              {behaviorEnQueries.length === 0 && <div>Немає даних</div>}
                              {behaviorEnQueries.map((x, i) => (
                                <div key={`en-${i}`}>{x.count} × {x.question}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {shouldShow('behavior') && (
                      <div className="stat metric-chart behavior-metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Поведінка користувачів</div>
                          <div className="stat-list">Середня довжина сесії (запитів): {analyticsData?.behavior?.avgSessionLength ?? 0}</div>
                          <div className="stat-list">Активних днів у статистиці: {(analyticsData?.behavior?.requestsByDay || []).length}</div>
                          <div className="stat-list">Унікальних запитів: {(analyticsData?.behavior?.topQuestions || []).length}</div>
                          <div className="behavior-range-row">
                            <span>Діапазон:</span>
                            <select
                              className="behavior-range-select"
                              value={behaviorRange}
                              onChange={(e) => {
                                setBehaviorRange(e.target.value);
                                setBehaviorPickerOpen(false);
                              }}
                            >
                              {BEHAVIOR_RANGE_OPTIONS.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <div className="behavior-picker-wrap" ref={behaviorPickerRef}>
                              <button
                                type="button"
                                className="behavior-period-trigger"
                                onClick={() => setBehaviorPickerOpen((v) => !v)}
                              >
                                <span>{formatBehaviorPeriodLabel(behaviorRange, behaviorPeriod)}</span>
                                <span className="caret">▾</span>
                              </button>
                              {renderBehaviorPeriodMenu()}
                            </div>
                          </div>
                          <div className="behavior-amount-row">
                            <span>Кількість</span>
                            <button
                              type="button"
                              className={behaviorAmountMode === 'users' ? 'amount-switch users' : 'amount-switch requests'}
                              onClick={() =>
                                setBehaviorAmountMode((prev) => (prev === 'users' ? 'requests' : 'users'))
                              }
                            >
                              <span className="amount-option">користувачів</span>
                              <span className="amount-option">запитів</span>
                            </button>
                          </div>
                        </div>
                        <div className="chart-group">
                          <MultiLineChart
                            items={behaviorSeries}
                            xAxisLabel={behaviorXAxisLabel}
                            yAxisLabel={behaviorYAxisLabel}
                          />
                          <div className="chart-legend behavior-legend">
                            <div className="legend-item">
                              <span className="legend-dot legend-dot-orange" />
                              <span>Українська</span>
                            </div>
                            <div className="legend-item">
                              <span className="legend-dot legend-dot-turquoise" />
                              <span>English</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {shouldShow('ops') && (
                      <div className="stat metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Стан системи та індексу</div>
                          <div className="stat-list">Проіндексованих документів: {analyticsData?.ops?.docsIndexed ?? 0}</div>
                          <div className="stat-list">Зміна після останнього оновлення: {analyticsData?.ops?.docsDelta ?? 0}</div>
                          <div className="stat-list">
                            Тривалість останнього оновлення бази: {analyticsData?.ops?.indexDurationMs ?? 0} мс
                          </div>
                        </div>
                        <div className="chart-group bar-group">
                          <BarChart
                            items={[
                              { label: 'Документи', value: analyticsData?.ops?.docsIndexed ?? 0 },
                              { label: 'Зміна', value: Math.abs(analyticsData?.ops?.docsDelta ?? 0) },
                              { label: 'Час, с', value: Math.round((analyticsData?.ops?.indexDurationMs ?? 0) / 1000) },
                            ]}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="analytics-lists">
                    {shouldShow('quality') && (
                      <div className="stat">
                        <div className="metric-lines">
                          <div className="stat-label">Найпроблемніші запити</div>
                          <div className="stat-list">
                            {(analyticsData?.quality?.problematicTop || []).slice(0, 8).map((x, i) => (
                              <div key={i}>{x.count} × {x.question}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {shouldShow('quality') && (
                      <div className="stat">
                        <div className="stat-label">Оцінені відповіді</div>
                        <div className="stat-list feedback-summary">
                          <div>Оцінено відповідей: {analyticsData?.quality?.feedback?.total ?? 0}</div>
                          <div>Позитивні: {analyticsData?.quality?.feedback?.positiveCount ?? 0}</div>
                          <div>Негативні: {analyticsData?.quality?.feedback?.negativeCount ?? 0}</div>
                        </div>
                        <div className="feedback-filter-row">
                          <button
                            className={feedbackFilter === 'all' ? 'feedback-filter-btn active' : 'feedback-filter-btn'}
                            onClick={() => setFeedbackFilter('all')}
                          >
                            Усі
                          </button>
                          <button
                            className={feedbackFilter === 'up' ? 'feedback-filter-btn active' : 'feedback-filter-btn'}
                            onClick={() => setFeedbackFilter('up')}
                          >
                            Позитивні
                          </button>
                          <button
                            className={feedbackFilter === 'down' ? 'feedback-filter-btn active' : 'feedback-filter-btn'}
                            onClick={() => setFeedbackFilter('down')}
                          >
                            Негативні
                          </button>
                        </div>
                        <div className="stat-list feedback-list">
                          {(analyticsData?.quality?.feedback?.recent || [])
                            .filter((item) => feedbackFilter === 'all' || item.value === feedbackFilter)
                            .slice(0, 10)
                            .map((item, i) => (
                              <div key={`${item.messageId}-${i}`}>
                                {item.value === 'up' ? '👍' : '👎'} {item.question || 'Без запитання'}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                    {shouldShow('model') && (
                      <div className="stat metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Причини помилок моделі</div>
                          <div className="stat-list">
                            {(analyticsData?.model?.topErrors || []).slice(0, 8).map((x, i) => (
                              <div key={i}>{String(x.code || '').toLowerCase() === 'unknown' ? 'Невизначена причина' : x.code}: {x.count}</div>
                            ))}
                          </div>
                        </div>
                        <div className="chart-group bar-group">
                          <BarChart
                            items={(analyticsData?.model?.topErrors || []).slice(0, 6).map((x) => ({
                              label: String(x.code || '').toLowerCase() === 'unknown' ? 'Невизначена причина' : x.code,
                              fullLabel: String(x.code || '').toLowerCase() === 'unknown' ? 'Невизначена причина' : String(x.code || ''),
                              value: x.count || 0,
                            }))}
                          />
                        </div>
                      </div>
                    )}
                    {shouldShow('rag') && (
                      <div className="stat metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Найчастіші джерела відповідей</div>
                          <div className="stat-list">
                            {(analyticsData?.rag?.topSources || []).slice(0, 8).map((x, i) => (
                              <div key={i}>{x.count} × {x.source}</div>
                            ))}
                          </div>
                        </div>
                        <div className="chart-group bar-group">
                          <BarChart
                            items={(analyticsData?.rag?.topSources || []).slice(0, 6).map((x) => ({
                              label: String(x.source || '') || 'Джерело',
                              fullLabel: String(x.source || '') || 'Джерело',
                              value: x.count || 0,
                            }))}
                          />
                        </div>
                      </div>
                    )}
                    {shouldShow('faq') && (
                      <div className="stat metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Автовідповіді, які не спрацьовували</div>
                          <div className="stat-list">
                            {(analyticsData?.faq?.unusedFaq || []).slice(0, 8).map((x, i) => (
                              <div key={i}>{x.question}</div>
                            ))}
                          </div>
                        </div>
                        <div className="chart-group bar-group">
                          <BarChart
                            items={(analyticsData?.faq?.topFaq || []).slice(0, 6).map((x) => ({
                              label: String(x.question || '') || 'Автовідповідь',
                              fullLabel: String(x.question || '') || 'Автовідповідь',
                              value: x.count || 0,
                            }))}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'updates' && (
            <section className="tab-section">
              <div className="update-card">
                <h2>Оновлення знань з офіційних сайтів</h2>
                <p className="muted">
                  Оновлення запускається автоматично щодня у заданий час. Процес може тривати кілька хвилин.
                </p>
                <div className="update-meta">
                  <div>Останнє оновлення: {lastIndexedAt ? new Date(lastIndexedAt).toLocaleString() : '—'}</div>
                  <div>Проіндексовано сторінок: {lastIndexedCount || '—'}</div>
                  <div>Автооновлення: {String(scheduleHour).padStart(2, '0')}:{String(scheduleMinute).padStart(2, '0')}</div>
                </div>
                <div className="health-grid">
                  <div className="health-card">
                    <div className="health-title">Стан чату</div>
                    <div className={systemStatus?.chat?.healthy ? 'health-ok' : 'health-warn'}>
                      {systemStatus?.chat?.message || 'Немає даних'}
                    </div>
                    <div className="health-sub">
                      Документів у базі: {systemStatus?.chat?.docsIndexed ?? '—'}
                    </div>
                  </div>
                  <div className="health-card">
                    <div className="health-title">Стан моделі</div>
                    <div className={!systemStatus?.model?.lastError ? 'health-ok' : 'health-warn'}>
                      {!systemStatus?.model?.lastError ? 'Модель працює' : systemStatus?.model?.lastError}
                    </div>
                    <div className="health-sub">
                      Залишок запитів: {systemStatus?.model?.remainingRequests ?? '—'}
                      {systemStatus?.model?.remainingSource === 'estimate' ? ' (оцінка)' : ''}
                    </div>
                    <div className="health-sub">
                      Викликів сьогодні: {systemStatus?.model?.callsToday ?? '—'}
                    </div>
                  </div>
                </div>
                <div className="progress-wrap">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (progress.indexed / Math.max(1, progress.indexed + progress.queued)) * 100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="progress-text">
                    {reindexing ? `Індексовано: ${progress.indexed} • У черзі: ${progress.queued}` : 'Оновлення не виконується'}
                  </div>
                </div>
                <div className="reindex-wrap">
                <button className="reindex-btn" onClick={() => setScheduleOpen((v) => !v)}>
                  Змінити час оновлення
                </button>
                {scheduleOpen && (
                  <div className="schedule-popover">
                    <div className="schedule-title">Час автооновлення</div>
                    <div className="schedule-pickers">
                      <select
                        value={scheduleHour}
                        onChange={(e) => {
                          const hour = Number(e.target.value);
                          setScheduleHour(hour);
                          saveSchedule(hour, scheduleMinute);
                        }}
                      >
                        {Array.from({ length: 24 }).map((_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                        ))}
                      </select>
                      <span>:</span>
                      <select
                        value={scheduleMinute}
                        onChange={(e) => {
                          const minute = Number(e.target.value);
                          setScheduleMinute(minute);
                          saveSchedule(scheduleHour, minute);
                        }}
                      >
                        {Array.from({ length: 60 }).map((_, m) => (
                          <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <div className="reindex-tip">
                  <span className="reindex-icon">!</span>
                  Щоденне автооновлення запускається у вказаний час
                </div>
                </div>
                  {reindexing && reindexStatus && (
                    <div className="status-text info">
                      <span className="info-icon">i</span>
                      {reindexStatus}
                    </div>
                  )}
                </div>
            </section>
          )}

          {activeTab === 'faq' && (
            <section className="tab-section">
              <div className="qa-editor single">
                <div className="qa-left">
                  <div className="section-title-row">
                    <h2>Додати запитання</h2>
                    <button
                      type="button"
                      className="content-lang-btn"
                      onClick={() => setContentLang((prev) => (prev === 'uk' ? 'en' : 'uk'))}
                    >
                      {contentLang === 'uk' ? 'English' : 'Українська'}
                    </button>
                  </div>
                  <div className="qa-inputs">
                    <textarea
                      className="qa-input"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Запитання"
                    />
                    <textarea
                      className="qa-input"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Відповідь"
                    />
                  </div>
                  <button
                    className={question.trim() && answer.trim() ? 'save-btn active' : 'save-btn'}
                    onClick={saveQa}
                    disabled={!question.trim() || !answer.trim()}
                  >
                    {editingId ? 'Зберегти зміни' : 'Зберегти'}
                  </button>
                  {errorMsg && <div className="status-text">{errorMsg}</div>}
                </div>
                <div className="qa-right">
                  <h2>Існуючі Q&A</h2>
                  <div className="qa-list">
                    {qa.map((item) => (
                      <div key={item.id} className="qa-item">
                        <div className="qa-q">{item.question}</div>
                        <div className="qa-a">{item.answer}</div>
                        <div className="qa-actions">
                          <button
                            className={editingId === item.id ? 'icon-btn edit active' : 'icon-btn edit'}
                            onClick={() => startEdit(item)}
                            title="Редагувати"
                          >
                            <IconPencil />
                          </button>
                          <button
                            className="icon-btn delete"
                            onClick={() => deleteQa(item.id)}
                            title="Видалити"
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'quick' && (
            <section className="tab-section">
              <div className="quick-admin">
                <div className="section-title-row">
                  <h2>Швидкі питання</h2>
                  <button
                    type="button"
                    className="content-lang-btn"
                    onClick={() => setContentLang((prev) => (prev === 'uk' ? 'en' : 'uk'))}
                  >
                    {contentLang === 'uk' ? 'English' : 'Українська'}
                  </button>
                </div>
                <div className="quick-add">
                  <input
                    className="qa-input"
                    value={quickDraft}
                    onChange={(e) => setQuickDraft(e.target.value)}
                    placeholder="Нове швидке питання"
                  />
                  <button
                    className={quickDraft.trim() ? 'save-btn active' : 'save-btn'}
                    disabled={!quickDraft.trim()}
                    onClick={() => {
                      const items = [...quickItems, quickDraft.trim()];
                      setQuickDraft('');
                      saveQuick(items);
                    }}
                  >
                    Додати
                  </button>
                </div>

                <div className="quick-list">
                  {quickItems.map((q, idx) => (
                    <div key={`${q}-${idx}`} className="quick-row">
                      <div className="quick-text">{q}</div>
                      <div className="quick-actions">
                        <button
                          className="icon-btn edit"
                          title="Вгору"
                          onClick={() => {
                            if (idx === 0) return;
                            const items = [...quickItems];
                            [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
                            saveQuick(items);
                          }}
                        >
                          <IconArrowUp />
                        </button>
                        <button
                          className="icon-btn edit"
                          title="Вниз"
                          onClick={() => {
                            if (idx === quickItems.length - 1) return;
                            const items = [...quickItems];
                            [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
                            saveQuick(items);
                          }}
                        >
                          <IconArrowDown />
                        </button>
                        <button
                          className="icon-btn delete"
                          title="Видалити"
                          onClick={() => {
                            const items = quickItems.filter((_, i) => i !== idx);
                            saveQuick(items);
                          }}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="quick-suggest">
                  <div className="stat-label">Запропоновані швидкі питання (з аналітики)</div>
                  <div className="quick-list">
                    {quickSuggestions.length === 0 && (
                      <div className="quick-suggest-empty">Немає нових рекомендацій.</div>
                    )}
                    {quickSuggestions.map((item, idx) => (
                      <div key={`${item.question}-${idx}`} className="quick-row">
                        <div className="quick-text">
                          {item.question}
                          <span className="quick-count">{item.count} ×</span>
                        </div>
                        <div className="quick-actions">
                          <button
                            className="quick-add-btn"
                            onClick={() => saveQuick([...quickItems, item.question])}
                          >
                            Додати
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
      {showResetModal && (
        <div
          className={resetModalClosing ? 'reset-modal-backdrop closing' : 'reset-modal-backdrop'}
          onClick={() => closeResetModal(true)}
        >
          <div className="reset-modal" onClick={(e) => e.stopPropagation()}>
            <div className="reset-modal-head">Скидання статистики</div>
            <div className="reset-modal-body">
              <h3>Увага</h3>
              <p>
                Ця операція безповоротно видалить аналітичну статистику запитів та подій моделі.
                Для виконання скидання підтвердь дію логіном і паролем адміністратора.
              </p>
            <div className="reset-modal-fields">
              <input
                className="auth-input"
                placeholder="Логін"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
              />
              <input
                className="auth-input"
                type="password"
                placeholder="Пароль"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
              />
            </div>
            <div className="reset-modal-actions">
              <button
                type="button"
                className="reset-cancel-btn"
                onClick={() => closeResetModal(true)}
              >
                Скасувати
              </button>
              <button
                type="button"
                className={resetEmail.trim() && resetPassword.trim() ? 'reset-confirm-btn active' : 'reset-confirm-btn'}
                onClick={resetAnalyticsStats}
                disabled={!resetEmail.trim() || !resetPassword.trim()}
              >
                Підтвердити скидання
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
      <footer className="footer">Острозька академія • Панель керування</footer>
    </div>
  );
}


