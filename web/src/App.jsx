import React, { useState, useEffect, useRef } from 'react';

// Local development uses the Node API on port 5000. In a production build,
// same-origin requests work when Express serves the site and API together.
// When hosted separately, configure VITE_API_BASE with the backend's HTTPS URL.
const apiBase = (import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '');
const INTRO_TEXT = {
  uk: 'Вітаю! Я помічник Острозької академії. Питайте про вступ, факультети, контакти, навчальні програми.',
  en: 'Hello! I am the Ostroh Academy assistant. Ask about admission, faculties, contacts, and study programs.',
};

function renderMessageText(text) {
  const lines = String(text || '').trim().split('\n');
  const blocks = [];
  const inline = value => value.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const numbered = /^\d+[.)]\s+/.test(line);
    const bulleted = /^[-*•]\s+/.test(line);
    if (numbered || bulleted) {
      const pattern = numbered ? /^\d+[.)]\s+/ : /^[-*•]\s+/;
      const items = [];
      while (i < lines.length && pattern.test(lines[i].trim())) {
        items.push(<li key={i}>{inline(lines[i].trim().replace(pattern, ''))}</li>); i++;
      }
      blocks.push(numbered ? <ol className="message-list ordered" key={i}>{items}</ol> : <ul className="message-list bulleted" key={i}>{items}</ul>);
    } else {
      blocks.push(<p key={i}>{inline(line.replace(/^#{1,6}\s+/, ''))}</p>); i++;
    }
  }
  return <div className="message-text">{blocks}</div>;
}

function useChat(lang = 'uk') {
  const sessionId=useRef(crypto.randomUUID());
  const msgSeq = useRef(1);
  const nextId = () => `m_${Date.now()}_${msgSeq.current++}`;

  const [messages, setMessages] = useState([
    {
      id: nextId(),
      role: 'assistant',
      text: INTRO_TEXT[lang] || INTRO_TEXT.uk,
      intro: true,
    },
  ]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      if (!prev[0]?.intro) return prev;
      return [{ ...prev[0], text: INTRO_TEXT[lang] || INTRO_TEXT.uk }, ...prev.slice(1)];
    });
  }, [lang]);

  async function sendMessage(text, messageLang = 'uk') {
    if (loading || !text.trim()) return;
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, lang: messageLang,sessionId:sessionId.current, history: messages.filter(m => !m.intro).slice(-10).map(m => ({ role: m.role, content: m.text })) }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'Server error'), { userMessage: data.error });
      setMessages((prev) => [
        ...prev,
        { id: nextId(), responseId: data.responseId, role: 'assistant', text: data.answer, sources: data.sources, question: text, sourceType: data.sourceType },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: err.userMessage || (
            messageLang === 'en'
              ? 'Sorry, an error occurred. Please try again later.'
              : 'Не вдалося отримати відповідь. Спробуйте ще раз за кілька секунд.'),
          question: text,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(message, value, reason = '') {
    if (!message.responseId) throw new Error('Оцінювати можна лише нові відповіді після оновлення.');
    const response = await fetch(`${apiBase}/api/chat/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responseId: message.responseId, value, reason }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Не вдалося зберегти оцінку');
    return data;
  }

  function resetConversation() {
    if (loading) return;
    sessionId.current=crypto.randomUUID();
    setMessages([{ id: nextId(), role: 'assistant', text: INTRO_TEXT[lang] || INTRO_TEXT.uk, intro: true }]);
  }

  return { messages, loading, sendMessage, sendFeedback, resetConversation };
}

// OA Smart Assistant v15: one conversation component in two responsive presentations.
// Embedded mode is automatically detected when the page is opened in an iframe.
function UiIcon({ name, size = 18, className = '' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    sparkle: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
    graduation: <><path d="m2 10 10-5 10 5-10 5-10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5M22 10v7"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    file: <><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M13 2v7h7M8 13h8M8 17h8"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l0-8Z"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>{paths[name] || paths.sparkle}</svg>;
}

function quickIconFor(question) {
  const q = String(question).toLocaleLowerCase();
  if (/розклад|дзвінк|schedule|time/.test(q)) return 'calendar';
  if (/програм|освіт|факультет|навчан|study|course/.test(q)) return 'graduation';
  if (/ректор|хто|контакт|who/.test(q)) return 'user';
  return 'file';
}

function ChatPanel() {
  const [lang, setLang] = useState('uk');
  const [langPulse, setLangPulse] = useState(false);
  const { messages, loading, sendMessage, sendFeedback, resetConversation } = useChat(lang);
  const [draft, setDraft] = useState('');
  const [showQuick, setShowQuick] = useState(true);
  const [quickQuestions, setQuickQuestions] = useState([]);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [ratings, setRatings] = useState({});
  const [negativeFor, setNegativeFor] = useState(null);
  const [negativeReason, setNegativeReason] = useState('incorrect');
  const [ratingError, setRatingError] = useState('');
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  async function loadQuick(currentLang) {
    setQuickLoading(true);
    setQuickError('');
    try {
      const res = await fetch(`${apiBase}/api/quick?lang=${currentLang === 'en' ? 'en' : 'uk'}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('quick_unavailable');
      const data = await res.json();
      setQuickQuestions(Array.isArray(data.items) ? data.items : []);
    } catch {
      setQuickQuestions([]);
      setQuickError(currentLang === 'en' ? 'Could not load questions.' : 'Не вдалося завантажити запитання.');
    } finally {
      setQuickLoading(false);
    }
  }

  useEffect(() => { loadQuick(lang); }, [lang]);

  async function rate(message, value, reason = '') {
    if (ratings[message.id]) return;
    setRatingError('');
    try {
      await sendFeedback(message, value, reason);
      setRatings(prev => ({ ...prev, [message.id]: value }));
      setNegativeFor(null);
    } catch {
      setRatingError(lang === 'en' ? 'Rating was not saved. Try again.' : 'Не вдалося зберегти оцінку. Спробуй ще раз.');
    }
  }

  useEffect(() => {
    if (!langPulse) return;
    const t = setTimeout(() => setLangPulse(false), 900);
    return () => clearTimeout(t);
  }, [langPulse]);

  async function send() {
    if (loading || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    setShowQuick(false);
    await sendMessage(text, lang);
    inputRef.current?.focus();
  }

  function newConversation() {
    if (loading) return;
    resetConversation();
    setRatings({});
    setNegativeFor(null);
    setRatingError('');
    setDraft('');
    setShowQuick(true);
    inputRef.current?.focus();
  }

  return (
    <section className="panel chat-panel" aria-label="OA Smart Assistant">
      <header className="panel-header oa-chat-header">
        <div className="header-topline">
          <div className="eyebrow">OA Smart Assistant</div>
          <button
            type="button"
            className={langPulse ? 'lang-switch pulse' : 'lang-switch'}
            title={lang === 'uk' ? 'Switch to English' : 'Перемкнути українською'}
            aria-label={lang === 'uk' ? 'Switch to English' : 'Перемкнути українською'}
            onClick={() => { setLang(prev => prev === 'uk' ? 'en' : 'uk'); setLangPulse(true); }}
          >
            <span className="lang-switch-inner">{lang === 'uk' ? 'УКР' : 'ENG'}</span>
          </button>
        </div>
        <div className="oa-title-row">
          <div className="oa-heading-copy">
            <h1>{lang === 'uk' ? 'Інтелектуальний чат-бот' : 'Intelligent chat assistant'}</h1>
            <p className="muted">{lang === 'uk'
              ? 'Відповіді на основі офіційних сайтів академії.'
              : 'Answers based on official academy websites.'}</p>
          </div>
          <button type="button" className="oa-new-chat" disabled={loading} onClick={newConversation}>
            <UiIcon name="plus" size={17}/><span>{lang === 'uk' ? 'Новий діалог' : 'New chat'}</span>
          </button>
        </div>
      </header>

      <div className="chat oa-messages" ref={chatRef} role="log" aria-label={lang === 'uk' ? 'Повідомлення діалогу' : 'Conversation messages'} aria-live="polite" aria-relevant="additions">
        {messages.map((m, i) => (
          <div key={m.id || i} className={`oa-message-row ${m.role}`}>
            {m.role === 'assistant' && <span className="oa-avatar"><UiIcon name="sparkle" size={19}/></span>}
            <div className={`bubble ${m.role}`}>
              {renderMessageText(m.text)}
              {m.sources?.length > 0 && (
                <div className="sources">
                  {lang === 'uk' ? 'Джерела:' : 'Sources:'}
                  {m.sources.map((source, idx) => (
                    <a key={idx} className="source-pill" href={/^https?:\/\//.test(source.url || '') ? source.url : undefined} target="_blank" rel="noopener noreferrer">
                      [{idx + 1}] {source.title || (lang === 'uk' ? 'Сторінка' : 'Page')}
                    </a>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && m.question && (
                <div className="feedback-row">
                  <span className="feedback-label">{lang === 'uk' ? 'Оціни відповідь:' : 'Rate answer:'}</span>
                  <button disabled={Boolean(ratings[m.id])} className={ratings[m.id] === 'up' ? 'feedback-btn active up' : 'feedback-btn'} onClick={() => rate(m, 'up')} title={lang === 'uk' ? 'Корисна відповідь' : 'Helpful answer'} aria-label={lang === 'uk' ? 'Корисна відповідь' : 'Helpful answer'}>👍</button>
                  <button disabled={Boolean(ratings[m.id])} className={ratings[m.id] === 'down' ? 'feedback-btn active down' : 'feedback-btn'} onClick={() => setNegativeFor(negativeFor === m.id ? null : m.id)} title={lang === 'uk' ? 'Некорисна відповідь' : 'Not helpful'} aria-label={lang === 'uk' ? 'Некорисна відповідь' : 'Not helpful'}>👎</button>
                  {negativeFor === m.id && !ratings[m.id] && (
                    <div className="feedback-reason-box">
                      <select value={negativeReason} onChange={e => setNegativeReason(e.target.value)} aria-label={lang === 'uk' ? 'Причина негативної оцінки' : 'Reason for negative rating'}>
                        <option value="incorrect">{lang === 'uk' ? 'Помилкові факти' : 'Incorrect facts'}</option>
                        <option value="irrelevant">{lang === 'uk' ? 'Не по темі' : 'Irrelevant'}</option>
                        <option value="incomplete">{lang === 'uk' ? 'Неповна відповідь' : 'Incomplete'}</option>
                        <option value="outdated">{lang === 'uk' ? 'Застарілі дані' : 'Outdated'}</option>
                        <option value="other">{lang === 'uk' ? 'Інша причина' : 'Other'}</option>
                      </select>
                      <button onClick={() => rate(m, 'down', negativeReason)}>{lang === 'uk' ? 'Надіслати оцінку' : 'Submit rating'}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="oa-message-row assistant"><span className="oa-avatar"><UiIcon name="sparkle" size={19}/></span>
            <div className="bubble assistant oa-typing" aria-label={lang === 'uk' ? 'Готую відповідь' : 'Preparing answer'}><span/><span/><span/></div>
          </div>
        )}
      </div>

      {ratingError && <div className="feedback-notice" role="alert">{ratingError}</div>}
      <section className="quick-wrap oa-quick" aria-label={lang === 'uk' ? 'Популярні запитання' : 'Popular questions'}>
        <button type="button" className="oa-quick-heading" aria-expanded={showQuick} onClick={() => { if (!showQuick && !quickQuestions.length) loadQuick(lang); setShowQuick(v => !v); }}>
          <span className="oa-bolt"><UiIcon name="bolt" size={16}/></span>
          <span>{lang === 'uk' ? 'Популярні запитання' : 'Popular questions'}</span>
          <span className={`oa-quick-chevron ${showQuick ? 'open' : ''}`}><UiIcon name="chevron" size={15}/></span>
        </button>
        {showQuick && (
          <div className="quick-panel">
            {quickLoading && <span className="quick-status">{lang === 'uk' ? 'Завантаження…' : 'Loading…'}</span>}
            {!quickLoading && quickError && <button className="quick-item" onClick={() => loadQuick(lang)}>{quickError} ↻</button>}
            {!quickLoading && !quickError && !quickQuestions.length && <span className="quick-status">{lang === 'uk' ? 'Питань поки немає. Адміністратор може додати їх.' : 'No quick questions configured yet.'}</span>}
            {!quickLoading && quickQuestions.map(q => (
              <button type="button" key={q} className="quick-item" onClick={() => { setDraft(q); inputRef.current?.focus(); }} title={q}>
                <UiIcon name={quickIconFor(q)} size={16}/><span>{q}</span>
                <UiIcon name="chevron" size={14} className="oa-item-arrow"/>
              </button>
            ))}
          </div>
        )}
      </section>

      <form className="composer oa-composer" onSubmit={event => { event.preventDefault(); send(); }}>
        <input
          ref={inputRef}
          aria-label={lang === 'uk' ? 'Ваше запитання' : 'Your question'}
          value={draft}
          maxLength={4000}
          onChange={event => setDraft(event.target.value)}
          placeholder={lang === 'uk' ? 'Ваше запитання...' : 'Your question...'}
        />
        <button type="submit" className="send-btn" disabled={loading || !draft.trim()} title={lang === 'uk' ? 'Надіслати' : 'Send'} aria-label={lang === 'uk' ? 'Надіслати' : 'Send'}>
          <UiIcon name="send" size={20}/>
        </button>
      </form>
    </section>
  );
}

function BrandRail() {
  return <aside className="oa-brand-rail" aria-hidden="true">
    <img className="oa-brand-mark" src="/oa-logo.png" alt=""/>
    <div className="oa-brand-name">OA<br/>Smart<br/>Assistant</div>
    <div className="oa-gold-line"/>
    <p>Інтелектуальний<br/>чат-бот<br/>Острозької академії</p>
    <div className="oa-architecture-mark">
      <svg viewBox="0 0 220 170" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="2.4" opacity=".65" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 150H205M25 144V83H196V144M21 84h179l-90-37-89 37Z"/>
          <path d="M89 46v-8h42v8M94 38V31l16-18 16 18v7M107 13V5h6v8"/>
          <path d="M40 94h140M40 142h140M50 92v49M70 92v49M90 92v49M110 92v49M130 92v49M150 92v49M170 92v49"/>
          <path d="M11 153q50-17 102 0 55-17 101 0M19 161q98-17 187 0"/>
        </g>
      </svg>
    </div>
  </aside>;
}

export default function App() {
  const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
  return (
    <div className={`app chat-page oa-v15 ${isEmbedded ? 'embedded' : 'standalone'}`}>
      <div className="bg-shape one" aria-hidden="true"/>
      <div className="bg-shape two" aria-hidden="true"/>
      <div className="oa-chat-layout">
        {!isEmbedded && <BrandRail/>}
        <main className="chat-main"><ChatPanel/></main>
      </div>
    </div>
  );
}
