import React, { useState, useEffect, useRef } from 'react';

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
const INTRO_TEXT = {
  uk: 'Вітаю! Я помічник Острозької академії. Питайте про вступ, факультети, контакти, навчальні програми.',
  en: 'Hello! I am the Ostroh Academy assistant. Ask about admission, faculties, contacts, and study programs.',
};

function renderMessageText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const numbered = lines.filter((line) => /^\d{1,2}\.\s+/.test(line));
  const dashed = lines.filter((line) => /^-\s+/.test(line));
  const hasNumberedList = numbered.length >= 2;
  const hasDashedList = dashed.length >= 2;

  if (!hasNumberedList && !hasDashedList) {
    return <div className="message-text">{raw}</div>;
  }

  const prefixLines = [];
  const listItems = [];

  for (const line of lines) {
    if (hasNumberedList && /^\d{1,2}\.\s+/.test(line)) {
      listItems.push(line.replace(/^\d{1,2}\.\s+/, '').trim());
      continue;
    }
    if (hasDashedList && /^-\s+/.test(line)) {
      listItems.push(line.replace(/^-\s+/, '').trim());
      continue;
    }
    prefixLines.push(line);
  }

  return (
    <div className="message-text">
      {prefixLines.length > 0 && <div>{prefixLines.join(' ')}</div>}
      {hasNumberedList ? (
        <ol className="message-list ordered">
          {listItems.map((item, idx) => (
            <li key={`${item}-${idx}`}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="message-list bulleted">
          {listItems.map((item, idx) => (
            <li key={`${item}-${idx}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useChat(lang = 'uk') {
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
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, lang: messageLang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', text: data.answer, sources: data.sources, question: text },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text:
            messageLang === 'en'
              ? 'Sorry, an error occurred. Please try again later.'
              : 'Вибачте, сталася помилка. Спробуйте пізніше.',
          question: text,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(message, value) {
    try {
      await fetch(`${apiBase}/api/chat/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: message.id,
          value,
          question: message.question || '',
          answer: message.text || '',
        }),
      });
    } catch {}
  }

  return { messages, loading, sendMessage, sendFeedback };
}

function ChatPanel() {
  const [lang, setLang] = useState('uk');
  const [langPulse, setLangPulse] = useState(false);
  const { messages, loading, sendMessage, sendFeedback } = useChat(lang);
  const [draft, setDraft] = useState('');
  const [showQuick, setShowQuick] = useState(false);
  const [quickQuestions, setQuickQuestions] = useState([]);
  const [quickLoaded, setQuickLoaded] = useState(false);
  const [ratings, setRatings] = useState({});

  async function loadQuick(currentLang) {
    try {
      const res = await fetch(`${apiBase}/api/admin/quick?lang=${currentLang === 'en' ? 'en' : 'uk'}`);
      const data = await res.json();
      setQuickQuestions(Array.isArray(data) ? data : []);
    } catch {}
  }

  useEffect(() => {
    if (quickLoaded) return;
    loadQuick(lang);
    setQuickLoaded(true);
  }, [quickLoaded, lang]);

  useEffect(() => {
    if (!quickLoaded) return;
    loadQuick(lang);
  }, [lang]);

  useEffect(() => {
    if (!langPulse) return;
    const t = setTimeout(() => setLangPulse(false), 900);
    return () => clearTimeout(t);
  }, [langPulse]);

  const send = async () => {
    const text = draft;
    setDraft('');
    await sendMessage(text, lang);
  };

  return (
    <div className="panel chat-panel">
      <div className="panel-header">
        <div>
          <div className="header-topline">
            <div className="eyebrow">ОА Smart Assistant</div>
            <button
              className={langPulse ? 'lang-switch pulse' : 'lang-switch'}
              title={lang === 'uk' ? 'Перемкнути на English' : 'Switch to Ukrainian'}
              onClick={() => {
                setLang((prev) => (prev === 'uk' ? 'en' : 'uk'));
                setLangPulse(true);
              }}
            >
              <span className="lang-switch-inner">{lang === 'uk' ? 'УКР' : 'ENG'}</span>
            </button>
          </div>
          <h1>{lang === 'uk' ? 'Інтелектуальний чат-бот' : 'Intelligent Chat Bot'}</h1>
          <p className="muted">
            {lang === 'uk'
              ? 'Відповіді на основі офіційних сайтів академії.'
              : 'Answers based on official academy websites.'}
          </p>
        </div>
      </div>

      <div className="chat">
        {messages.map((m, i) => (
          <div key={m.id || i} className={`bubble ${m.role}`}>
            {renderMessageText(m.text)}
            {false && m.sources && m.sources.length > 0 && (
              <div className="sources">
                Джерела:
                {m.sources.map((s, idx) => (
                  <span key={idx} className="source-pill">
                    {s.title || 'Сторінка'}
                  </span>
                ))}
              </div>
            )}
            {m.role === 'assistant' && m.question && (
              <div className="feedback-row">
                <span className="feedback-label">{lang === 'uk' ? 'Оціни відповідь:' : 'Rate answer:'}</span>
                <button
                  className={ratings[m.id] === 'up' ? 'feedback-btn active up' : 'feedback-btn'}
                  onClick={() => {
                    setRatings((prev) => ({ ...prev, [m.id]: 'up' }));
                    sendFeedback(m, 'up');
                  }}
                  title={lang === 'uk' ? 'Корисна відповідь' : 'Helpful answer'}
                >
                  👍
                </button>
                <button
                  className={ratings[m.id] === 'down' ? 'feedback-btn active down' : 'feedback-btn'}
                  onClick={() => {
                    setRatings((prev) => ({ ...prev, [m.id]: 'down' }));
                    sendFeedback(m, 'down');
                  }}
                  title={lang === 'uk' ? 'Некорисна відповідь' : 'Not helpful'}
                >
                  👎
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && <div className="bubble assistant">{lang === 'uk' ? 'Готую відповідь...' : 'Preparing answer...'}</div>}
      </div>

      <div className="quick-wrap">
        <button className="quick-toggle" onClick={() => setShowQuick((v) => !v)}>
          {lang === 'uk'
            ? showQuick
              ? 'Згорнути швидкі питання'
              : 'Швидке питання'
            : showQuick
            ? 'Collapse quick questions'
            : 'Quick question'}
        </button>
        {showQuick && quickQuestions.length > 0 && (
          <div className="quick-panel">
            {quickQuestions.map((q) => (
              <button
                key={q}
                className="quick-item"
                onClick={() => {
                  setDraft(q);
                  setShowQuick(false);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={lang === 'uk' ? 'Ваше запитання...' : 'Your question...'}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button className="send-btn" onClick={send} disabled={loading}>
          {lang === 'uk' ? 'Надіслати' : 'Send'}
        </button>
      </div>
    </div>
  );
}

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

export default function App() {
  const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
  return (
    <div className={isEmbedded ? 'app chat-page embedded' : 'app chat-page'}>
      <div className="bg-shape one" />
      <div className="bg-shape two" />
      <header className="topbar">
        <Logo />
      </header>
      <main className="chat-main">
        <ChatPanel />
      </main>
      <footer className="footer">Острозька академія • Smart Assistant</footer>
    </div>
  );
}







