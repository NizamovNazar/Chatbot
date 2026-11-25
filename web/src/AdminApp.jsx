import React, { useEffect, useMemo, useRef, useState } from 'react';
import { academicReportData, downloadAcademicDocx, downloadAcademicHtml, printAcademicReport } from './reportExport.js';
import {RESPONSE_LABELS} from '../../shared/responseTypes.mjs';

// Local development uses the Node API on port 5000. In a production build,
// same-origin requests work when Express serves the site and API together.
// When hosted separately, configure VITE_API_BASE with the backend's HTTPS URL.
const apiBase = (import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '');

const TABS = [
  { id: 'analytics', label: 'Аналітика' },
  { id: 'reports', label: 'Звіти' },
  { id: 'updates', label: 'Оновлення даних' },
  { id: 'faq', label: 'Автовідповіді' },
  { id: 'reviews', label: 'Перевірка відповідей' },
  { id: 'quick', label: 'Швидкі питання' },
];

const ANALYTICS_FILTERS = [
  { id: 'quality', label: 'Якість відповідей', short: 'Контекст і відгуки', icon: '◈', description: 'Відповіді без знайденого контексту, резервні сценарії та оцінки користувачів. Це не експертний вимір точності.' },
  { id: 'model', label: 'Стан моделей', short: 'Виклики й помилки', icon: '◇', description: 'Результативність викликів мовних моделей, коди помилок та час відповіді.' },
  { id: 'rag', label: 'Пошук RAG', short: 'Фрагменти й джерела', icon: '⌕', description: 'Кількість знайдених фрагментів, випадки порожнього пошуку та джерела, які потрапили до журналу.' },
  { id: 'faq', label: 'Автовідповіді', short: 'FAQ і маршрутизація', icon: '◎', description: 'Співвідношення відповідей FAQ і мовної моделі та записи, які поки не використовувалися.' },
  { id: 'behavior', label: 'Користувачі', short: 'Запити й активність', icon: '↗', description: 'Найпоширеніші питання, активні дні, тривалість сесій та активність за вибраний період.' },
  { id: 'ops', label: 'Система й індекс', short: 'Індексація та стан', icon: '▤', description: 'Обсяг індексованих документів, зміна під час оновлення та його тривалість.' },
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

function SegmentedControl({ options, value, onChange, className = '', ariaLabel, role = 'tablist' }) {
  const activeIndex = Math.max(options.findIndex((option) => option.value === value), 0);
  const rootClassName = ['v21-segmented-control', className].filter(Boolean).join(' ');

  return (
    <div
      className={rootClassName}
      role={role}
      aria-label={ariaLabel}
      style={{ '--segment-count': options.length }}
    >
      <div className="v21-segmented-indicator" style={{ transform: `translateX(${activeIndex * 100}%)` }} />
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={role === 'tablist' ? 'tab' : undefined}
              tabIndex={role==='tablist'?(isActive?0:-1):0}
              onKeyDown={event=>{
                const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
                if(!keys.includes(event.key))return;event.preventDefault();
                const current=options.findIndex(x=>x.value===value);
                const next=event.key==='Home'?0:event.key==='End'?options.length-1:(current+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+options.length)%options.length;
                onChange(options[next].value);event.currentTarget.parentElement.querySelectorAll('button')[next]?.focus();
              }}
            aria-selected={role === 'tablist' ? isActive : undefined}
            aria-pressed={role !== 'tablist' ? isActive : undefined}
            className={isActive ? 'v21-segmented-btn active' : 'v21-segmented-btn'}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
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


const numberUa = (n) => new Intl.NumberFormat('uk-UA').format(Number(n) || 0);
const percentageUa = (n, total) => total > 0 ? `${((Number(n) || 0) * 100 / total).toFixed(1).replace('.', ',')}%` : '—';

// Власні картки показників кожного розділу: лише факти, доступні в API аналітики.
function AnalyticsDetailOverview({ data, section }) {
  const q = data?.quality || {};
  const m = data?.model || {};
  const r = data?.rag || {};
  const f = data?.faq || {};
  const b = data?.behavior || {};
  const o = data?.ops || {};
  const votes = q.feedback || {};
  const modelCalls = (Number(m.success) || 0) + (Number(m.errors) || 0);
  const itemsBySection = {
    quality: [
      ['Звернення у журналі', numberUa(q.total), 'Усі зареєстровані звернення'],
      ['Без контексту', numberUa(q.noContext), 'Запити без знайденого контексту'],
      ['Резервні відповіді', numberUa(q.fallback), 'Використано fallback-сценарій'],
      ['Позитивні оцінки', percentageUa(votes.positiveCount, votes.total), `${numberUa(votes.positiveCount)} із ${numberUa(votes.total)} оцінок`],
    ],
    model: [
      ['Викликів моделі', numberUa(modelCalls), 'Успішні та помилкові'],
      ['Успішні виклики', percentageUa(m.success, modelCalls), `${numberUa(m.success)} результатів без помилки API`],
      ['Помилки моделі', numberUa(m.errors), 'Технічні збої викликів'],
      ['Типова затримка (P50)', `${numberUa(m.latencyP50)} мс`, `P95: ${numberUa(m.latencyP95)} мс`],
    ],
    rag: [
      ['Фрагментів на пошук', numberUa(r.avgContexts), 'Середнє значення з журналу'],
      ['Порожній пошук', numberUa((r.emptySearches || []).length), 'Випадки, повернуті API'],
      ['Джерел у рейтингу', numberUa((r.topSources || []).length), 'Позиції в отриманому топі'],
      ['Звернень у журналі', numberUa(q.total), 'Контекст загальної активності'],
    ],
    faq: [
      ['Відповіді FAQ', numberUa(f.faqResponses), percentageUa(f.faqResponses, q.total) + ' від звернень'],
      ['Відповіді моделі', numberUa(f.llmResponses), percentageUa(f.llmResponses, q.total) + ' від звернень'],
      ['Помилки обробки', numberUa(f.errorResponses), 'Зареєстровані помилки'],
      ['FAQ без використання', numberUa((f.unusedFaq || []).length), 'Позиції у вибірці API'],
    ],
    behavior: [
      ['Активних днів', numberUa((b.requestsByDay || []).length), 'Дні з записами в журналі'],
      ['Середня сесія', `${numberUa(b.avgSessionLength)} зап.`, 'Середня довжина сесії'],
      ['Звернень за днями', numberUa((b.requestsByDay || []).reduce((sum,x)=>sum+(Number(x.count)||0),0)), 'Сума відображених днів'],
      ['Питань у рейтингу', numberUa((b.topQuestions || []).length), 'Позиції у вибірці API'],
    ],
    ops: [
      ['Документів в індексі', numberUa(o.docsIndexed), 'Значення з системної статистики'],
      ['Зміна індексу', `${Number(o.docsDelta)>0?'+':''}${numberUa(o.docsDelta)}`, 'Після останнього оновлення'],
      ['Час оновлення', `${numberUa(o.indexDurationMs)} мс`, 'Остання зафіксована операція'],
      ['Викликів моделі', numberUa(modelCalls), 'За наявними подіями'],
    ],
  };
  const selected = ANALYTICS_FILTERS.find((s) => s.id === section) || ANALYTICS_FILTERS[0];
  return <div className="v17-detail-overview">
    <div className="v17-detail-title">
      <div><div className="v17-detail-eyebrow">Деталізація · {selected.short}</div><h3>{selected.label}</h3><p>{selected.description}</p></div>
      <span className="v17-detail-indicator" aria-hidden="true">{selected.icon}</span>
    </div>
    <div className="v17-detail-kpis">
      {(itemsBySection[selected.id] || []).map(([label,value,subtitle]) => <article className="v17-detail-kpi" key={label}>
        <span>{label}</span><strong>{value}</strong><small>{subtitle}</small>
      </article>)}
    </div>
  </div>;
}

// Пошук і розгортання здійснюються тільки всередині даних, які повернув сервер.
// Це не запит до повного архіву подій у PostgreSQL.
function AnalyticsEntryList({ entries = [], getText, search = '', defaultLimit = 8, empty = 'Немає записів для відображення' }) {
  const [expanded, setExpanded] = useState(false);
  const filtered = entries.filter((item) => (getText(item) || '').toLocaleLowerCase('uk-UA').includes(search.trim().toLocaleLowerCase('uk-UA')));
  const visible = expanded ? filtered : filtered.slice(0, defaultLimit);
  return <div className="v17-entry-list">
    {visible.length ? visible.map((item, i) => <div className="v17-entry" key={i}><span className="v17-entry-rank">{i + 1}</span><span>{getText(item)}</span></div>) : <div className="v17-entry-empty">{search ? 'За цим пошуком нічого не знайдено' : empty}</div>}
    {filtered.length > defaultLimit && <button type="button" className="v17-more" onClick={() => setExpanded((x) => !x)}>{expanded ? 'Згорнути список' : `Показати всі (${filtered.length})`}</button>}
  </div>;
}

function AnalyticsOverview({ data, refresh }) {
  const total = Number(data?.quality?.total || 0);
  const faq = Number(data?.faq?.faqResponses || 0);
  const feedback = data?.quality?.feedback || {};
  const votes = Number(feedback.total || 0);
  const positive = Number(feedback.positiveCount || 0);
  const modelSuccess = Number(data?.model?.success || 0);
  const modelErrors = Number(data?.model?.errors || 0);
  const modelCalls = modelSuccess + modelErrors;
  const trend = (data?.behavior?.requestsByDay || []).slice(-14);
  const maxTrend = Math.max(1, ...trend.map((x) => Number(x.count) || 0));
  const metrics = [
    { label: 'Звернення до чат-бота', value: numberUa(total), subtitle: 'Усі зафіксовані звернення', icon: '↗' },
    { label: 'Опрацьовано через FAQ', value: numberUa(faq), subtitle: `${percentageUa(faq, total)} від усіх звернень`, icon: '◎' },
    { label: 'Успішні виклики моделі', value: percentageUa(modelSuccess, modelCalls), subtitle: `${numberUa(modelSuccess)} із ${numberUa(modelCalls)} викликів`, icon: '◇' },
    { label: 'Позитивні відгуки', value: percentageUa(positive, votes), subtitle: `${numberUa(positive)} із ${numberUa(votes)} оцінок`, icon: '♡' },
  ];
  return (
    <div className="v16-overview">
      <div className="v16-section-head">
        <div>
          <div className="v16-eyebrow">Операційна аналітика</div>
          <h2>Показники роботи асистента</h2>
          <p>За фактичними журналами системи. Це статистика використання, а не експертна оцінка точності.</p>
        </div>
        <button type="button" className="v16-refresh" onClick={refresh} aria-label="Оновити аналітику">↻ Оновити дані</button>
      </div>
      <div className="v16-kpi-grid">
        {metrics.map((m) => (
          <article className="v16-kpi" key={m.label}>
            <span className="v16-kpi-icon" aria-hidden="true">{m.icon}</span>
            <span className="v16-kpi-label">{m.label}</span>
            <strong>{m.value}</strong>
            <small>{m.subtitle}</small>
          </article>
        ))}
      </div>
      <div className="v16-overview-panels">
        <article className="v16-overview-card">
          <div className="v16-card-head"><strong>Динаміка звернень</strong><span>Останні {trend.length || 0} активних днів у журналі</span></div>
          {trend.length ? <div className="v16-trend" role="img" aria-label="Кількість звернень за днями">
            {trend.map((x, i) => <div className="v16-trend-item" key={`${x.day}-${i}`} title={`${x.day}: ${x.count} запитів`}>
              <span className="v16-trend-count">{x.count}</span>
              <span className="v16-trend-column"><span style={{ height: `${Math.max(6, Number(x.count || 0) / maxTrend * 100)}%` }} /></span>
              <span className="v16-trend-date">{String(x.day || '').slice(5)}</span>
            </div>)}
          </div> : <p className="v16-muted">Історія звернень поки порожня.</p>}
        </article>
        <article className="v16-overview-card">
          <div className="v16-card-head"><strong>Як обробляються звернення</strong><span>Структура за журналами</span></div>
          {[
            { label: 'FAQ', v: faq, c: 'var(--v17-primary)' },
            { label: 'Мовна модель', v: Number(data?.faq?.llmResponses || 0), c: '#4c8ce8' },
            { label: 'Помилки', v: Number(data?.faq?.errorResponses || 0), c: '#e78f63' },
          ].map((item) => (
            <div className="v16-breakdown" key={item.label}>
              <div className="v16-breakdown-text"><span>{item.label}</span><strong>{numberUa(item.v)} <small>· {percentageUa(item.v, total)}</small></strong></div>
              <div className="v16-bar-track"><span style={{ width: `${total ? Math.min(100, item.v * 100 / total) : 0}%`, background: item.c }} /></div>
            </div>
          ))}
          <div className="v16-data-hint">Позитивний відгук користувача не доводить фактичної достовірності відповіді.</div>
        </article>
      </div>
    </div>
  );
}

function ReportTable({ headers, rows }) {
  return <div className="v16-table-scroll"><table className="v16-report-table"><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>
    {rows.length ? rows.map((r, idx) => <tr key={idx}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>) : <tr><td colSpan={headers.length} className="v16-report-empty-cell">Даних за період немає</td></tr>}
  </tbody></table></div>;
}
function AcademicReportPreview({ report }) {
  const d = academicReportData(report);
  return <article className="v16-academic-sheet">
    <div className="v16-document-masthead"><strong>{d.institution}</strong><span>Внутрішній аналітичний документ</span></div>
    <h2>{d.title}</h2>
    <p className="v16-document-subtitle">{d.subtitle}</p>
    <div className="v16-document-details"><span><b>Тип:</b> {d.type}</span><span><b>Період:</b> {d.period}</span><span><b>Сформовано:</b> {d.generated} (Київ)</span><span><b>ID:</b> {d.reportId}</span></div>
    <section><h3>1. Предмет і джерела аналізу</h3><p>{d.methodology}</p></section>
    <section><h3>2. Основні кількісні показники</h3><ReportTable headers={['Показник','Значення']} rows={d.metrics}/></section>
    <section><h3>3. Структура відповідей</h3><ReportTable headers={['Спосіб обробки','Кількість','Частка']} rows={d.sourceRows}/></section>
    <section><h3>4. Зворотний зв’язок</h3><ReportTable headers={['Показник','Кількість','Частка оцінок']} rows={d.feedbackRows}/></section>
    <section><h3>5. Найчастіші запитання</h3><ReportTable headers={['№','Запитання (з маскуванням контактів)','Кількість']} rows={d.questions}/></section>
    <section><h3>6. Тематичний розподіл</h3><ReportTable headers={['№','Тематика','Кількість']} rows={d.intents}/></section>
    <section><h3>7. Обмеження інтерпретації</h3><p>{d.limitations}</p></section>
    <section><h3>8. Фактичний висновок</h3><p>{d.conclusion}</p></section>
    <div className="v16-document-foot">OA Smart Assistant · автоматичний операційний звіт. Перед публікацією перевірити персональні дані.</div>
  </article>;
}

export default function AdminApp() {
  const [theme, setTheme] = useState(() => localStorage.getItem('adminTheme') || 'dark');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [authBusy,setAuthBusy]=useState(false);
  const [loginRetryAt,setLoginRetryAt]=useState(0);
  const [authNow,setAuthNow]=useState(Date.now());
  useEffect(()=>{if(!loginRetryAt)return;const timer=setInterval(()=>setAuthNow(Date.now()),1000);return()=>clearInterval(timer);},[loginRetryAt]);
  const [stats, setStats] = useState(null);
  const [qa, setQa] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [qaBaseline, setQaBaseline] = useState({ question: '', answer: '' });
  const [qaDialog, setQaDialogState] = useState(null);
  const qaReturnFocus=useRef(null);
  function setQaDialog(value){
    if(value&&!qaDialog)qaReturnFocus.current=document.activeElement;
    setQaDialogState(value);
  }
  const [qaBusy, setQaBusy] = useState(false);
  useEffect(()=>{
    if(!qaDialog)return;
    const previous=qaReturnFocus.current,dialog=document.querySelector('[aria-labelledby="qa-dialog-title"]');
    const onKey=event=>{
      if(event.key==='Escape'&&!qaBusy){event.preventDefault();setQaDialog(null);return;}
      if(event.key!=='Tab'||!dialog)return;
      const nodes=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
      if(!nodes.length)return;
      if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}
      else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}
    };
    document.addEventListener('keydown',onKey);return()=>{document.removeEventListener('keydown',onKey);if(!dialog?.isConnected&&previous?.isConnected)previous.focus();};
  },[qaDialog,qaBusy]);
  const [qaSearch, setQaSearch] = useState('');
  const [quickItems, setQuickItems] = useState([]);
  const [quickDraft, setQuickDraft] = useState('');
  const [quickSuggestions, setQuickSuggestions] = useState([]);
  const [contentLang, setContentLang] = useState('uk');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsSearch, setAnalyticsSearch] = useState('');
  const [exploreFilters, setExploreFilters] = useState({ from: '', to: '', source: 'all', lang: 'all', feedback: 'all', q: '', page: 1 });
  const [exploreData, setExploreData] = useState(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState('');
  const [exploreExporting, setExploreExporting] = useState(false);
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
  const [reviewFilter, setReviewFilter] = useState('pending');
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewStats, setReviewStats] = useState({});
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [reviewBusy, setReviewBusy] = useState(null);
  const [reviewMessage, setReviewMessage] = useState('');
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
  const [analyticsView, setAnalyticsView] = useState('journal');
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
  const [reportType, setReportType] = useState('weekly');
  const [reports, setReports] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [generatingReport, setGeneratingReport] = useState(false);


  // Кожен адміністративний запит несе токен, перевірений сервером.
  async function adminFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}) },
    });
    if (response.status === 401) {
      setAdminToken('');
      setPassword('');
      setLoggedIn(false);
      setErrorMsg('Сесія адміністратора завершилася. Увійдіть повторно.');
      throw new Error('admin_auth_required');
    }
    return response;
  }

  const normalizeQaQuestion = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  const qaDuplicateCounts = useMemo(() => {
    const map = new Map();
    for (const item of qa) {
      const key = normalizeQaQuestion(item.question);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [qa]);

  const filteredQa = useMemo(() => {
    const query = qaSearch.trim().toLowerCase();
    if (!query) return qa;
    return qa.filter((item) => {
      const q = String(item.question || '').toLowerCase();
      const a = String(item.answer || '').toLowerCase();
      return q.includes(query) || a.includes(query);
    });
  }, [qa, qaSearch]);

  const draftDuplicateCount = useMemo(() => {
    const key = normalizeQaQuestion(question);
    if (!key) return 0;
    return qa.filter((item) => {
      if (editingId && item.id === editingId) return false;
      return normalizeQaQuestion(item.question) === key;
    }).length;
  }, [qa, question, editingId]);

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
    if(authBusy||Date.now()<loginRetryAt)return;
    setAuthBusy(true);
    try {
    const res = await fetch(`${apiBase}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.token) {
      setLoggedIn(false);
      setAdminToken('');
      if(res.status===429){const seconds=Math.max(1,Number(res.headers.get('Retry-After'))||Number(data.retryAfter)||60);setLoginRetryAt(Date.now()+seconds*1000);setErrorMsg(`Тимчасове обмеження входу. Повторіть спробу через ${seconds} с.`);}
      else setErrorMsg(res.status===503?'Авторизація тимчасово недоступна. Спробуйте пізніше.':'Невірний логін або пароль.');
      return;
    }
    setAdminToken(data.token);
    setPassword('');
    setLoginRetryAt(0);
    setErrorMsg('');
    setLoggedIn(true);
    } catch { setErrorMsg('Не вдалося зв’язатися із сервером авторизації.'); }
    finally { setAuthBusy(false); }
  }

  async function logout(){
    setAuthBusy(true);
    try{const response=await adminFetch(`${apiBase}/api/admin/logout`,{method:'POST'});if(!response.ok)throw new Error('logout_failed');setAdminToken('');setLoggedIn(false);setPassword('');setResetPassword('');setQa([]);setReviewItems([]);setAnalyticsData(null);setReports([]);setErrorMsg('');}
    catch{setErrorMsg('Не вдалося відкликати сесію. Повторіть вихід.');}
    finally{setAuthBusy(false);}
  }

  async function loadStats() {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/stats`);
      const data = await res.json();
      setStats(data);
    } catch {
      setErrorMsg('Не вдалося підключитися до сервера (бекенд вимкнено).');
    }
  }

  async function loadQa() {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/qa?lang=${contentLang}`);
      const data = await res.json();
      setQa(data);
    } catch {
      setErrorMsg('Не вдалося підключитися до сервера (бекенд вимкнено).');
    }
  }

  async function loadQuick() {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/quick?lang=${contentLang}`);
      const data = await res.json();
      setQuickItems(Array.isArray(data) ? data : []);
    } catch {
      setErrorMsg('Не вдалося отримати швидкі питання.');
    }
  }

  async function loadQuickSuggestions() {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/quick/suggestions?lang=${contentLang}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('quick_suggestions_failed');
      setQuickSuggestions(Array.isArray(data.items) ? data.items : []);
    } catch {
      setQuickSuggestions([]);
    }
  }

  async function loadReviews(filter = reviewFilter) {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/reviews?status=${filter}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('review_load_failed');
      setReviewItems(Array.isArray(data.items) ? data.items : []);
      setReviewStats(data.stats || {});
    } catch {
      setReviewMessage('Не вдалося завантажити чергу перевірки. Перевір авторизацію.');
    }
  }

  function editReview(id, key, value) {
    setReviewDrafts(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  }

  async function handleReview(item, action) {
    if (reviewBusy) return;
    const draft = reviewDrafts[item.id] || {};
    const payload = {
      action,
      question: draft.question ?? item.question,
      answer: draft.answer ?? (item.value === 'up' ? item.answer : ''),
      sourceUrl: draft.sourceUrl || '',
      note: draft.note || '',
      reason: draft.reason || item.reason || '',
      addToQuick: draft.addToQuick === true,
    };
    if (action === 'publish') {
      if (payload.question.trim().length < 7 || payload.answer.trim().length < 15) {
        setReviewMessage('Заповни запитання та перевірену відповідь. Для негативної оцінки виправ відповідь вручну.');
        return;
      }
      if (!window.confirm('Ви перевірили факти та джерела? Опублікована відповідь буде використовуватися без виклику ШІ.')) return;
    }
    setReviewBusy(item.id);
    setReviewMessage('');
    try {
      const res = await adminFetch(`${apiBase}/api/admin/reviews/${encodeURIComponent(item.id)}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error === 'faq_exists' ? 'Таке запитання вже є в FAQ. Перевір розділ «Автовідповіді».' : 'Не вдалося зберегти рішення.');
      setReviewMessage(action === 'publish' ? 'Перевірену відповідь додано до FAQ.' : 'Рішення адміністратора збережено.');
      await loadReviews(reviewFilter);
      if (action === 'publish') { loadQa(); loadQuick(); loadAnalytics(); }
    } catch (err) {
      setReviewMessage(err.message);
    } finally {
      setReviewBusy(null);
    }
  }

  async function loadAnalytics() {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/analytics`);
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
      await adminFetch(`${apiBase}/api/admin/quick`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: deduped, lang: contentLang }),
      });
      loadQuickSuggestions();
    } catch {
      setErrorMsg('Не вдалося зберегти швидкі питання.');
    }
  }

  const qaDirty = question !== qaBaseline.question || answer !== qaBaseline.answer;
  const qaFormActive = Boolean(editingId) || qaDirty;

  function clearQaDraft() {
    setQuestion('');
    setAnswer('');
    setEditingId(null);
    setQaBaseline({ question: '', answer: '' });
    setQaDialog(null);
  }

  function requestCancelQa() {
    if (qaDirty) setQaDialog({ action: 'cancel' });
    else clearQaDraft();
  }

  async function saveQa() {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a || !qaDirty || qaBusy) return;
    setQaBusy(true);
    setErrorMsg('');
    try {
      const path = editingId ? `${apiBase}/api/admin/qa/${editingId}` : `${apiBase}/api/admin/qa`;
      const response = await adminFetch(path, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, answer: a, lang: contentLang, enabled: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'save_failed');
      clearQaDraft();
      await loadQa();
    } catch {
      setErrorMsg('Не вдалося зберегти автовідповідь. Зміни залишилися в редакторі.');
    } finally {
      setQaBusy(false);
    }
  }

  async function deleteQa(id) {
    if (qaBusy) return;
    setQaBusy(true);
    setErrorMsg('');
    try {
      const response = await adminFetch(`${apiBase}/api/admin/qa/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('delete_failed');
      if (editingId === id) clearQaDraft();
      await loadQa();
      setQaDialog(null);
    } catch {
      setErrorMsg('Не вдалося видалити автовідповідь. Спробуй ще раз.');
      setQaDialog(null);
    } finally {
      setQaBusy(false);
    }
  }

  function startEdit(item) {
    if (qaDirty) {
      setQaDialog({ action: 'switch', itemId: item.id });
      return;
    }
    openQaEdit(item);
  }

  function openQaEdit(item) {
    setEditingId(item.id);
    setQuestion(item.question || '');
    setAnswer(item.answer || '');
    setQaBaseline({ question: item.question || '', answer: item.answer || '' });
    setQaDialog(null);
  }

  function confirmQaDialog() {
    if (!qaDialog) return;
    if (qaDialog.action === 'delete') { deleteQa(qaDialog.itemId); return; }
    if (qaDialog.action === 'switch') {
      const nextItem = qa.find((item) => item.id === qaDialog.itemId);
      if (nextItem) openQaEdit(nextItem);
      else clearQaDraft();
      return;
    }
    clearQaDraft();
  }

  function updateExploreFilter(field, value) {
    setExploreFilters((prev) => ({ ...prev, [field]: value, page: 1 }));
  }

  async function loadExplore(filters = exploreFilters) {
    setExploreLoading(true);
    setExploreError('');
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value !== 'all'));
      const response = await adminFetch(`${apiBase}/api/admin/analytics/explore?${params}`);
      if (!response.ok) throw new Error('explore_failed');
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'explore_failed');
      setExploreData(data);
    } catch {
      setExploreError('Не вдалося завантажити журнал. Перевір підключення до сервера.');
    } finally { setExploreLoading(false); }
  }

  async function exportExplore() {
    setExploreExporting(true);
    try {
      const params = new URLSearchParams(Object.entries(exploreFilters).filter(([key, value]) => key !== 'page' && value !== '' && value !== 'all'));
      params.set('format', 'csv');
      const response = await adminFetch(`${apiBase}/api/admin/analytics/explore?${params}`);
      if (!response.ok) throw new Error('export_failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oa-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch { setExploreError('Не вдалося експортувати дані.'); }
    finally { setExploreExporting(false); }
  }

  async function loadReindexStatus() {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/reindex/status`);
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
      const res = await adminFetch(`${apiBase}/api/admin/system-status`);
      const data = await res.json();
      if (!data.ok) return;
      setSystemStatus(data);
    } catch {
      setErrorMsg('Не вдалося отримати стан чату та моделі.');
    }
  }

  async function loadSchedule() {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/reindex/schedule`);
      const data = await res.json();
      if (!data.ok) return;
      setScheduleHour(Number(data.hour) || 0);
      setScheduleMinute(Number(data.minute) || 0);
    } catch {
      setErrorMsg('Не вдалося отримати час автооновлення.');
    }
  }

  async function loadReports(type = reportType) {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/reports?type=${type}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('reports_failed');
      const items = Array.isArray(data.items) ? data.items : [];
      setReports(items);
      setSelectedReportId((prev) => (items.some((x) => x.id === prev) ? prev : items[0]?.id || null));
    } catch {
      setErrorMsg('Не вдалося завантажити звіти.');
    }
  }

  async function generateReportNow() {
    setGeneratingReport(true);
    try {
      const res = await adminFetch(`${apiBase}/api/admin/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: reportType }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('report_generate_failed');
      await loadReports(reportType);
    } catch {
      setErrorMsg('Не вдалося сформувати звіт.');
    } finally {
      setGeneratingReport(false);
    }
  }

  async function saveSchedule(hour, minute) {
    try {
      const res = await adminFetch(`${apiBase}/api/admin/reindex/schedule`, {
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
      const res = await adminFetch(`${apiBase}/api/admin/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
      loadReviews(reviewFilter);
      loadSchedule();
      loadReports(reportType);
    }
  }, [loggedIn, contentLang]);

  useEffect(() => {
    if (!loggedIn) return;
    loadReports(reportType);
  }, [loggedIn, reportType]);

  useEffect(() => {
    setQuestion('');
    setAnswer('');
    setEditingId(null);
    setQaBaseline({ question: '', answer: '' });
    setQuickDraft('');
  }, [contentLang]);

  useEffect(() => {
    if (loggedIn && activeTab === 'reviews') loadReviews(reviewFilter);
  }, [loggedIn, activeTab, reviewFilter]);

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
    loadExplore(exploreFilters);
  }, [loggedIn, activeTab, exploreFilters]);

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
    setAnalyticsSearch('');
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
      const res = await adminFetch(`${apiBase}/api/admin/analytics/reset`, {
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
  const behaviorYAxisLabel = behaviorAmountMode === 'users' ? 'Діалоги' : 'Запити';
  const selectedReport = reports.find((x) => x.id === selectedReportId) || null;

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
            <form className="form-grid auth-form" onSubmit={event=>{event.preventDefault();login();}}>
              <input className="auth-input" type="email" autoComplete="username" aria-label="Email адміністратора" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
              <input
                className="auth-input"
                type="password"
                autoComplete="current-password"
                aria-label="Пароль адміністратора"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
              />
              <button type="submit" disabled={authBusy||authNow<loginRetryAt}>{authBusy?'Перевірка…':authNow<loginRetryAt?`Зачекайте ${Math.ceil((loginRetryAt-authNow)/1000)} с`:'Увійти'}</button>
              {errorMsg && <p role="alert" className="muted">{errorMsg}</p>}
            </form>
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
        <button type="button" className="theme-toggle" disabled={authBusy} onClick={logout}>Вийти</button>
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

          <div className="tab-bar" style={{ '--tab-count': TABS.length }}>
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
            <section className="tab-section v16-analytics-section">
              <AnalyticsOverview data={analyticsData} refresh={loadAnalytics} />
              <nav className="v19-analytics-switch" aria-label="Режим перегляду аналітики">
                <div className="v19-switch-track" role="group" aria-label="Розділи аналітики">
                  <button type="button" className={analyticsView === 'journal' ? 'v19-switch-option active' : 'v19-switch-option'} aria-pressed={analyticsView === 'journal'} onClick={() => setAnalyticsView('journal')}>Журнал запитів</button>
                  <button type="button" className={analyticsView === 'details' ? 'v19-switch-option active' : 'v19-switch-option'} aria-pressed={analyticsView === 'details'} onClick={() => setAnalyticsView('details')}>Детальна аналітика</button>
                </div>
              </nav>
              <div className="v19-analytics-view" hidden={analyticsView !== 'journal'}>
              <section className="v18-explorer" aria-label="Універсальний журнал аналітики">
                <div className="v18-explorer-heading">
                  <div><span className="v18-eyebrow">ДОСЛІДЖЕННЯ ДАНИХ</span><h2>Універсальний журнал запитів</h2><p>Пошук у повній історії, комбіновані фільтри та експорт вибірки.</p></div>
                  <button type="button" className="v18-export-btn" disabled={exploreExporting} onClick={exportExplore}>{exploreExporting ? 'Експорт…' : 'Експортувати CSV'}</button>
                </div>
                <div className="v18-filter-grid">
                  <label>Від дати<input type="date" value={exploreFilters.from} max={exploreFilters.to || undefined} onChange={(e) => updateExploreFilter('from', e.target.value)} /></label>
                  <label>До дати<input type="date" value={exploreFilters.to} min={exploreFilters.from || undefined} onChange={(e) => updateExploreFilter('to', e.target.value)} /></label>
                  <label>Механізм<select value={exploreFilters.source} onChange={(e) => updateExploreFilter('source', e.target.value)}><option value="all">Усі джерела</option>{Object.entries(RESPONSE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
                  <label>Мова<select value={exploreFilters.lang} onChange={(e) => updateExploreFilter('lang', e.target.value)}><option value="all">Усі мови</option><option value="uk">Українська</option><option value="en">Англійська</option></select></label>
                  <label>Оцінка<select value={exploreFilters.feedback} onChange={(e) => updateExploreFilter('feedback', e.target.value)}><option value="all">Усі оцінки</option><option value="up">Позитивна</option><option value="down">Негативна</option><option value="none">Без оцінки</option></select></label>
                  <label className="v18-search-field">Текст запитання або відповіді<input type="search" value={exploreFilters.q} placeholder="Пошук по всьому журналу…" onChange={(e) => updateExploreFilter('q', e.target.value)} /></label>
                  <button type="button" className="v18-clear-btn" onClick={() => setExploreFilters({ from: '', to: '', source: 'all', lang: 'all', feedback: 'all', q: '', page: 1 })}>Очистити</button>
                </div>
                {exploreError && <p role="alert" className="v18-explorer-error">{exploreError}</p>}
                <div className="v18-explorer-kpis">
                  <div><small>Знайдено запитів</small><strong>{exploreData?.total ?? '—'}</strong></div>
                  <div><small>Через модель</small><strong>{exploreData?.summary?.llm ?? '—'}</strong></div>
                  <div><small>Автовідповіді</small><strong>{exploreData?.summary?.faq ?? '—'}</strong></div>
                  <div><small>Негативні оцінки</small><strong>{exploreData?.summary?.negative ?? '—'}</strong></div>
                </div>
                <div className="v18-table-scroll"><table className="v18-data-table"><thead><tr><th>Дата й час</th><th>Запитання</th><th>Механізм</th><th>Мова</th><th>Оцінка</th></tr></thead><tbody>
                  {(exploreData?.items || []).map((entry, idx) => <tr key={`${entry.id || entry.at}-${idx}`}><td className="v18-nowrap">{entry.at ? new Date(entry.at).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'}) : '—'}</td><td title={entry.answer || ''}>{entry.question || '—'}</td><td><span className="v18-source-pill">{RESPONSE_LABELS[entry.source] || RESPONSE_LABELS.unknown}</span></td><td>{entry.lang === 'uk' ? 'УКР' : entry.lang === 'en' ? 'ENG' : '—'}</td><td>{entry.feedback === 'up' ? '👍' : entry.feedback === 'down' ? '👎' : '—'}</td></tr>)}
                  {!exploreLoading && !exploreData?.items?.length && <tr><td colSpan="5" className="v18-table-empty">За вибраними умовами записів немає.</td></tr>}
                </tbody></table></div>
                <div className="v18-pagination"><span>{exploreLoading ? 'Завантаження…' : `Сторінка ${exploreData?.page || 1} із ${exploreData?.pages || 1} · ${exploreData?.total ?? 0} записів`}</span><div><button type="button" disabled={exploreLoading || exploreFilters.page <= 1} onClick={() => setExploreFilters((p) => ({ ...p, page: p.page - 1 }))}>Назад</button><button type="button" disabled={exploreLoading || exploreFilters.page >= (exploreData?.pages || 1)} onClick={() => setExploreFilters((p) => ({ ...p, page: p.page + 1 }))}>Далі</button></div></div>
              </section>
              </div>
              <div className="v19-analytics-view" hidden={analyticsView !== 'details'}>
              <div className="v16-details-label"><h2>Детальна аналітика</h2><p>Вибери розділ, щоб переглянути пов'язані метрики й журнали.</p></div>
              <div className={filtersCollapsed ? 'analytics-layout filters-collapsed' : 'analytics-layout'}>
                <div className="filters-toolbar-line">
                  <button
                    type="button"
                    className="filter-collapse"
                    title={filtersCollapsed ? 'Розгорнути фільтри' : 'Згорнути фільтри'}
                    onClick={() => setFiltersCollapsed((v) => !v)}
                  >
                    <svg className="v19-filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/><circle cx="9" cy="7" r="2" fill="var(--v17-primary)" stroke="currentColor"/><circle cx="15" cy="12" r="2" fill="var(--v17-primary)" stroke="currentColor"/></svg>
                    <span className="filter-collapse-label">
                      {filtersCollapsed ? 'Розгорнути фільтри' : 'Згорнути фільтри'}
                    </span>
                    <svg className={filtersCollapsed ? 'v19-chevron' : 'v19-chevron expanded'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <div className="analytics-detail-hint">Дані з журналів · обери категорію ліворуч</div>
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
                    <button
                      type="button"
                      key={f.id}
                      title={f.label}
                      aria-pressed={analyticsFilters.includes(f.id)}
                      onClick={() => toggleAnalyticsFilter(f.id)}
                      className={[
                        analyticsFilters.includes(f.id) ? 'filter-radio active' : 'filter-radio',
                        dragFilterId === f.id ? 'dragging' : '',
                      ].filter(Boolean).join(' ')}
                      draggable
                      onDragStart={() => handleFilterDragStart(f.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleFilterDrop(f.id)}
                      onDragEnd={() => setDragFilterId(null)}
                    >
                      <span className="filter-dot" aria-hidden="true">{f.icon}</span>
                      <span className="filter-label"><strong>{f.label}</strong><small>{f.short}</small></span>
                      <span className="v17-nav-arrow" aria-hidden="true">›</span>
                    </button>
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
                  <AnalyticsDetailOverview data={analyticsData} section={activeAnalyticsIds[0]} />
                  <div className="v17-list-toolbar">
                    <div><strong>Деталізовані відомості</strong><small>Графіки й записи, наявні в системній статистиці</small></div>
                    <label className="v17-list-search">
                      <span aria-hidden="true">⌕</span>
                      <input aria-label="Пошук у списках цього розділу" type="search" value={analyticsSearch} onChange={(e)=>setAnalyticsSearch(e.target.value)} placeholder="Пошук у списках…" />
                    </label>
                  </div>
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
                          <BarChart
                            items={[
                              { label: 'Без контексту', value: analyticsData?.quality?.noContext ?? 0 },
                              { label: 'Резервні відповіді', value: analyticsData?.quality?.fallback ?? 0 },
                            ]}
                            height={145}
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
                              { label: 'Успішно', value: analyticsData?.model?.success ?? 0, color: 'var(--v17-primary)' },
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
                              { label: 'Автовідповіді', value: analyticsData?.faq?.faqResponses ?? 0, color: 'var(--v17-primary)' },
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
                              <AnalyticsEntryList search={analyticsSearch} entries={behaviorUkQueries} getText={(x)=>`${x.count} × ${x.question}`} />
                            </div>
                          </div>
                          <div className="behavior-col behavior-col-en">
                            <div className="behavior-col-title">Англомовні запити</div>
                            <div className="stat-list">
                              {behaviorEnQueries.length === 0 && <div>Немає даних</div>}
                              <AnalyticsEntryList search={analyticsSearch} entries={behaviorEnQueries} getText={(x)=>`${x.count} × ${x.question}`} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {shouldShow('behavior') && (
                      <div className="stat metric-chart behavior-metric-chart">
                        <div className="metric-lines">
                          <div className="stat-label">Поведінка користувачів</div>
                          <div className="stat-list">Середня довжина діалогу (запитів): {analyticsData?.behavior?.avgSessionLength ?? 'Немає даних'}</div>
                          <div className="stat-list">Історичних запитів без ID діалогу: {analyticsData?.behavior?.unknownSessionRequests ?? 0}</div>
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
                            <SegmentedControl
                              className="v21-segmented-compact v21-amount-switch"
                              ariaLabel="Режим кількості"
                              role="group"
                              value={behaviorAmountMode}
                              onChange={setBehaviorAmountMode}
                              options={[
                                { value: 'users', label: 'діалогів' },
                                { value: 'requests', label: 'запитів' },
                              ]}
                            />
                          </div>
                        </div>
                        <div className="chart-group">
                          {behaviorAmountMode==='users' && !analyticsData?.behavior?.knownSessions ? <p role="status">Немає записів з ID діалогу. Історичні запити враховані окремо.</p> : <MultiLineChart
                            items={behaviorSeries}
                            xAxisLabel={behaviorXAxisLabel}
                            yAxisLabel={behaviorYAxisLabel}
                          />}
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
                          <div className="v17-ops-explain">Документи, зміна кількості й час оновлення мають різні одиниці виміру, тому не порівнюються на одному графіку. Їхні точні значення наведено вище.</div>
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
                            <AnalyticsEntryList search={analyticsSearch} entries={analyticsData?.quality?.problematicTop || []} getText={(x)=>`${x.count} × ${x.question || 'Без запитання'}`} />
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
                            .filter((item)=>String(item.question || '').toLocaleLowerCase('uk-UA').includes(analyticsSearch.trim().toLocaleLowerCase('uk-UA')))
                            .slice(0, 20)
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
                            <AnalyticsEntryList search={analyticsSearch} entries={analyticsData?.model?.topErrors || []} getText={(x)=>`${String(x.code || '').toLowerCase() === 'unknown' ? 'Невизначена причина' : x.code}: ${x.count}`} />
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
                            <AnalyticsEntryList search={analyticsSearch} entries={analyticsData?.rag?.topSources || []} getText={(x)=>`${x.count} × ${x.source || 'Без джерела'}`} />
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
                            <AnalyticsEntryList search={analyticsSearch} entries={analyticsData?.faq?.unusedFaq || []} getText={(x)=>x.question || 'Без назви'} />
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
                  <div>Повна індексація: {lastIndexedAt ? new Date(lastIndexedAt).toLocaleString() : '—'}</div>
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
                      {systemStatus?.chat?.referencesUpdatedAt && <div>Ключові джерела: {new Date(systemStatus.chat.referencesUpdatedAt).toLocaleString()} ({systemStatus.chat.referencePages} сторінок)</div>}
                    </div>
                  </div>
                  <div className="health-card">
                    <div className="health-title">Стан моделі</div>
                    <div className={systemStatus?.model?.configured && !systemStatus?.model?.lastError ? 'health-ok' : 'health-warn'}>
                      {!systemStatus?.model?.configured ? 'Додайте API-ключі провайдерів у server/.env' : systemStatus?.model?.lastError || (systemStatus?.model?.activeProvider ? 'Останній виклик успішний' : 'Налаштовано, очікує перевірки')}
                    </div>
                    <div className="health-sub">
                      Остання активна модель: {systemStatus?.model?.activeModel || 'Ще не викликалась'}
                    </div>
                    <div className="health-sub">
                      Викликів сьогодні: {systemStatus?.model?.callsToday ?? '—'}
                    </div>
                    {(systemStatus?.model?.providers || []).map(p => (
                      <div className="health-sub" key={p.id}>
                        {p.id}: {p.model} — {p.state === 'missing_key' ? 'немає ключа' : p.state === 'cooldown' ? 'тимчасова пауза' : p.state === 'invalid_model' ? 'потрібна безкоштовна модель :free' : 'готовий до виклику'}
                        {p.lastError ? ` (${p.lastError})` : ''}
                      </div>
                    ))}
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

          {activeTab === 'reports' && (
            <section className="tab-section v16-reports-section">
              <div className="v16-section-head">
                <div>
                  <div className="v16-eyebrow">Документообіг і звітність</div>
                  <h2>Аналітичні звіти</h2>
                  <p>Збережені щотижневі та щомісячні підсумки. Кожен звіт можна завантажити окремо.</p>
                </div>
              </div>
              <div className="reports-card v16-reports-card">
                <div className="reports-toolbar v16-report-toolbar">
                  <SegmentedControl
                    className="reports-type-switch"
                    ariaLabel="Тип звіту"
                    value={reportType}
                    onChange={setReportType}
                    options={[
                      { value: 'weekly', label: 'Тижневі' },
                      { value: 'monthly', label: 'Місячні' },
                    ]}
                  />
                  <button type="button" className="reports-generate-btn" onClick={generateReportNow} disabled={generatingReport}>
                    {generatingReport ? 'Формування…' : '+ Сформувати звіт'}
                  </button>
                </div>
                <div className="v16-report-note">Звіти відображають статистику роботи системи, не результати академічного тестування мовних моделей. Старі записи з PostgreSQL доступні без повторного формування.</div>
                <div className="reports-layout">
                  <aside className="reports-list v16-reports-list" aria-label="Збережені звіти">
                    <div className="v16-list-heading">Архів звітів <span>{reports.length}</span></div>
                    {reports.map((item) => (
                      <div key={item.id} className={selectedReportId === item.id ? 'v16-report-entry active' : 'v16-report-entry'}>
                        <button type="button" className="v16-report-select" onClick={() => setSelectedReportId(item.id)} aria-current={selectedReportId === item.id ? 'true' : undefined}>
                          <strong>{item.periodLabel}</strong><small>Створено {new Date(item.createdAt).toLocaleDateString('uk-UA')}</small>
                          <span>{numberUa(item.summary?.totalRequests || 0)} звернень</span>
                        </button>
                        <button type="button" className="v16-report-quick-download" title="Завантажити цей звіт у Word (DOCX)" aria-label={`Завантажити звіт ${item.periodLabel} у DOCX`} onClick={() => downloadAcademicDocx(item)}>↓ DOCX</button>
                      </div>
                    ))}
                    {!reports.length && <div className="reports-empty">У цій категорії ще немає звітів. Натисни «Сформувати звіт».</div>}
                  </aside>
                  <div className="report-preview v16-report-preview">
                    {selectedReport ? <>
                      <div className="v16-preview-actions">
                        <div><strong>Попередній перегляд</strong><span>Формат аркуша A4 · структурований звіт</span></div>
                        <div className="v16-export-buttons">
                          <button type="button" className="v16-export-primary" onClick={() => downloadAcademicDocx(selectedReport)}>↓ Word (.docx)</button>
                          <button type="button" onClick={() => downloadAcademicHtml(selectedReport)}>↓ HTML</button>
                          <button type="button" onClick={() => { try { printAcademicReport(selectedReport); } catch (e) { setErrorMsg(e.message); } }}>Друк / PDF</button>
                        </div>
                      </div>
                      <AcademicReportPreview report={selectedReport} />
                    </> : <div className="reports-empty">Обери звіт ліворуч або сформуй новий.</div>}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'reviews' && (
            <section className="tab-section review-section">
              <div className="review-header">
                <div>
                  <h2>Контроль якості відповідей</h2>
                  <p className="muted">Оцінка користувача — сигнал для перевірки, а не підтвердження правильності. Лише адміністратор публікує виправлені або перевірені відповіді.</p>
                </div>
                <button className="quick-add-btn" onClick={() => loadReviews(reviewFilter)}>Оновити список</button>
              </div>
              <div className="review-stats">
                <span>Очікують: {reviewStats.pending ?? 0}</span>
                <span>Додано до FAQ: {reviewStats.published ?? 0}</span>
                <span>Запитів без ШІ завдяки перевіреним FAQ: {analyticsData?.quality?.reviewedFaqHits ?? 0}</span>
                <span>Закрито: {reviewStats.resolved ?? 0}</span>
              </div>
              <div className="review-filters">
                {[['pending', 'На перевірці'], ['published', 'Опубліковані'], ['resolved', 'Виправлені'], ['dismissed', 'Відхилені'], ['all', 'Усі']].map(([value, label]) => (
                  <button key={value} className={reviewFilter === value ? 'feedback-filter-btn active' : 'feedback-filter-btn'} onClick={() => { setReviewFilter(value); setReviewMessage(''); }}>{label}</button>
                ))}
              </div>
              {reviewMessage && <p className="review-notice" role="status">{reviewMessage}</p>}
              {reviewItems.length === 0 && <div className="quick-suggest-empty">Немає записів для цього фільтра.</div>}
              <div className="review-grid">
                {reviewItems.map(item => {
                  const draft = reviewDrafts[item.id] || {};
                  const editable = item.status === 'pending' && Boolean(item.responseId);
                  return (
                    <div className="review-card" key={item.id || item.messageId}>
                      <div className="review-card-top">
                        <strong>{item.value === 'up' ? '👍 Позитивна оцінка' : '👎 Негативна оцінка'}</strong>
                        <span>{item.status === 'pending' ? 'Очікує перевірки' : item.status === 'published' ? 'Додано до FAQ' : item.status || 'Історичний запис'}</span>
                      </div>
                      <label>Запитання користувача</label>
                      <div className="review-original">{item.question || '—'}</div>
                      <label>Відповідь системи</label>
                      <div className="review-original">{item.answer || '—'}</div>
                      {item.reason && <div className="muted">Причина від користувача: {item.reason}</div>}
                      <div className="muted">Механізм: {item.sourceType || 'невідомий'} · {item.created_at ? new Date(item.created_at).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'}) : ''}</div>
                      {editable && (
                        <div className="review-editor">
                          <label>Запитання для перевіреного FAQ</label>
                          <input className="qa-input" value={draft.question ?? item.question ?? ''} onChange={e => editReview(item.id, 'question', e.target.value)} maxLength={500}/>
                          <label>Перевірена відповідь (редагується адміністратором)</label>
                          <textarea className="qa-input" rows="4" value={draft.answer ?? (item.value === 'up' ? item.answer : '')} onChange={e => editReview(item.id, 'answer', e.target.value)} placeholder="Введіть перевірену інформацію"/>
                          <label>Посилання на підтверджувальне джерело (необов'язково)</label>
                          <input className="qa-input" value={draft.sourceUrl ?? ''} onChange={e => editReview(item.id, 'sourceUrl', e.target.value)} placeholder="https://..."/>
                          <label>Причина помилки або примітка</label>
                          <textarea className="qa-input" rows="2" value={draft.note ?? ''} onChange={e => editReview(item.id, 'note', e.target.value)} placeholder="Що перевірено або виправлено"/>
                          <label className="review-checkbox"><input type="checkbox" checked={draft.addToQuick === true} onChange={e => editReview(item.id, 'addToQuick', e.target.checked)}/> Також додати кнопку в «Швидкі питання»</label>
                          <div className="review-actions">
                            <button disabled={reviewBusy === item.id} className="save-btn active" onClick={() => handleReview(item, 'publish')}>Перевірено → FAQ</button>
                            <button disabled={reviewBusy === item.id} className="feedback-filter-btn" onClick={() => handleReview(item, 'resolve')}>Закрити після аналізу</button>
                            <button disabled={reviewBusy === item.id} className="feedback-filter-btn" onClick={() => handleReview(item, 'dismiss')}>Відхилити</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                  {qaFormActive && (
                    <div className="qa-form-actions">
                      <button type="button" className="qa-cancel-btn" disabled={qaBusy} onClick={requestCancelQa}>Скасувати</button>
                      <button type="button" className="qa-save-btn" onClick={saveQa} disabled={qaBusy || !qaDirty || !question.trim() || !answer.trim()}>
                        {qaBusy ? 'Збереження…' : editingId ? 'Зберегти зміни' : 'Зберегти'}
                      </button>
                    </div>
                  )}
                  {draftDuplicateCount > 0 && (
                    <div className="qa-duplicate-hint">
                      Дублікат запитання: знайдено {draftDuplicateCount} {draftDuplicateCount === 1 ? 'запис' : 'записи'}
                    </div>
                  )}
                  {errorMsg && <div className="status-text">{errorMsg}</div>}
                </div>
                <div className="qa-right">
                  <div className="section-title-row">
                    <h2>Існуючі Q&A</h2>
                    <input
                      className="qa-search"
                      value={qaSearch}
                      onChange={(e) => setQaSearch(e.target.value)}
                      placeholder="Пошук по запитанню/відповіді"
                    />
                  </div>
                  <div className="qa-search-meta">
                    Показано: {filteredQa.length} з {qa.length}
                  </div>
                  <div className="qa-list">
                    {filteredQa.map((item) => {
                      const isDuplicate = (qaDuplicateCounts.get(normalizeQaQuestion(item.question)) || 0) > 1;
                      return (
                      <div key={item.id} className={isDuplicate ? 'qa-item duplicate' : 'qa-item'}>
                        <div className="qa-q">{item.question}</div>
                        <div className="qa-a">{item.answer}</div>
                        {isDuplicate && <div className="qa-duplicate-badge">Дублікат</div>}
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
                            onClick={() => setQaDialog({ action: 'delete', itemId: item.id })}
                            title="Видалити"
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </div>
                    )})}
                    {!filteredQa.length && <div className="qa-empty">Нічого не знайдено за цим запитом</div>}
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
      {qaDialog && (
        <div className="reset-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !qaBusy) setQaDialog(null); }}>
          <div className="reset-modal v18-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="qa-dialog-title" aria-describedby="qa-dialog-desc">
            <div className="v18-dialog-heading" id="qa-dialog-title">{qaDialog.action === 'delete' ? 'Видалити автовідповідь?' : 'Незбережені зміни'}</div>
            <div className="reset-modal-body"><p id="qa-dialog-desc">{qaDialog.action === 'delete' ? 'Автовідповідь буде видалено. Відновити її після видалення неможливо.' : 'У редакторі є незбережені зміни. Якщо продовжити, їх буде втрачено.'}</p>
              <div className="reset-modal-actions"><button type="button" className="qa-cancel-btn" autoFocus disabled={qaBusy} onClick={() => setQaDialog(null)}>Повернутися</button><button type="button" className={qaDialog.action === 'delete' ? 'v18-danger-btn' : 'qa-save-btn'} disabled={qaBusy} onClick={confirmQaDialog}>{qaDialog.action === 'delete' ? 'Видалити' : 'Не зберігати'}</button></div>
            </div>
          </div>
        </div>
      )}
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


