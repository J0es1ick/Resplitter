import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReceiptSession } from '../../src/interfaces/receipt-session';
import type { Currency } from '../../src/domain/currency';
import { demoReceipt } from '../../src/domain/demo';
import { calculateSettlement } from '../../src/domain/settlement';
import { quantityUnits } from '../../src/domain/quantity';
import { api, ApiError, errorMessage } from './api';
import type { SessionView } from './api';
import { telegram } from './telegram';
import './style.css';

const formatCurrency = (minor: number, currency: Currency = 'RUB') =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
const icons = {
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6',
  split: 'M12 21V12m0 0-6-6m6 6 6-6M3 6h6M3 6v6M21 6h-6m6 0v6',
  check: 'm5 12 4 4L19 6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 0a4 4 0 0 1 0 8',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  share: 'M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7',
  close: 'm6 6 12 12M6 18 18 6',
  info: 'M12 11v6m0-10v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  back: 'm15 5-7 7 7 7'
};
function Icon({ name, size = 20 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name]} />
    </svg>
  );
}
function demo(): SessionView {
  const s: ReceiptSession = {
    id: 'demo',
    ownerUserId: 1,
    sourceChatId: 1,
    receipt: demoReceipt(),
    version: 1,
    status: 'open',
    splitMode: 'items',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    participants: {
      '1': { userId: 1, displayName: 'Вы', itemIds: ['burrata', 'pizza'], updatedAt: new Date().toISOString() },
      '2': { userId: 2, displayName: 'Саша', itemIds: ['pasta', 'pizza', 'lemonade'], updatedAt: new Date().toISOString() }
    }
  };
  return { ...s, userId: 1, reviewUrl: '', settlement: calculateSettlement(s) };
}
function App() {
  const [preview] = useState(new URLSearchParams(location.search).get('demo') === '1');
  const [session, setSession] = useState<SessionView>();
  const [sessions, setSessions] = useState<Array<{ id: string; number: string; totalMinor: number; status: string; currency: Currency }>>(
    []
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<'items' | 'summary' | 'receipt'>('items');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [invite, setInvite] = useState('');
  const mounted = useRef(true);
  const initData = telegram?.initData || '';
  const selectionKey = (ids: string[], values: Record<string, number> = {}) =>
    JSON.stringify(
      [...ids].sort().map((id) => [id, Object.hasOwn(values, id) ? (Number.isFinite(values[id]) ? values[id] : 'invalid') : null])
    );
  const dirty =
    !!session &&
    selectionKey(selected, quantities) !==
      selectionKey(
        session.participants[String(session.userId)]?.itemIds || [],
        session.participants[String(session.userId)]?.itemQuantities
      );
  const owner = session?.userId === session?.ownerUserId;
  const final = session?.status === 'finalized';
  const apply = (s: SessionView) => {
    setSession(s);
    setSelected(s.participants[String(s.userId)]?.itemIds || []);
    setQuantities(s.participants[String(s.userId)]?.itemQuantities || {});
  };

  async function open(id: string) {
    setLoading(true);
    setError('');
    try {
      let s = await api<SessionView>('/sessions/' + id, initData);
      if (!s.participants[String(s.userId)] && s.status !== 'finalized')
        s = await api<SessionView>('/sessions/' + id + '/join', initData, {});
      if (mounted.current) {
        apply(s);
        setTab(s.status === 'draft' ? 'receipt' : 'items');
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    telegram?.ready();
    telegram?.expand();
    const theme = () => {
      document.documentElement.dataset.theme = telegram?.colorScheme || 'light';
    };
    theme();
    telegram?.onEvent('themeChanged', theme);
    if (preview) {
      apply(demo());
      setLoading(false);
    } else if (!initData) setLoading(false);
    else {
      const id = new URLSearchParams(location.search).get('session');
      if (id) void open(id);
      else
        void api<{ sessions: typeof sessions }>('/sessions', initData)
          .then((r) => setSessions(r.sessions))
          .catch((e) => setError(errorMessage(e)))
          .finally(() => setLoading(false));
    }
    return () => {
      mounted.current = false;
      telegram?.offEvent('themeChanged', theme);
    };
  }, []);
  useEffect(() => {
    if (dirty) telegram?.enableClosingConfirmation();
    else telegram?.disableClosingConfirmation();
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);
  useEffect(() => {
    if (!session || preview || busy) return;
    let active = true;
    const timer = setInterval(() => {
      void api<SessionView>('/sessions/' + session.id, initData)
        .then((s) => {
          if (active && s.version !== session.version) {
            if (
              !dirty ||
              s.status === 'finalized' ||
              s.splitMode !== session.splitMode ||
              JSON.stringify(s.receipt) !== JSON.stringify(session.receipt)
            )
              apply(s);
            else setSession(s);
          }
        })
        .catch((e: unknown) => {
          if (!active) return;
          if (e instanceof ApiError && ['RECEIPT_NOT_CONFIRMED', 'SESSION_NOT_FOUND', 'SESSION_FORBIDDEN'].includes(e.code)) {
            setSession(undefined);
            setSelected([]);
            setQuantities({});
            setError(errorMessage(e));
          } else setNotice('Не удалось обновить данные. Ваш сохранённый выбор остаётся на сервере.');
        });
    }, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session, preview, busy, dirty]);

  async function mutate(action: string, payload: Record<string, unknown> = {}) {
    if (!session || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'selection') {
        try {
          Object.values(quantities).forEach(quantityUnits);
        } catch {
          throw new ApiError('INVALID_QUANTITY');
        }
      }
      if (preview) {
        const next = structuredClone(session);
        if (action === 'selection') {
          next.participants['1'].itemIds = [...selected];
          next.participants['1'].itemQuantities = { ...quantities };
          if (calculateSettlement(next).overallocatedItemIds.length) throw new ApiError('QUANTITY_EXCEEDED');
        }
        if (action === 'mode') next.splitMode = payload.mode as 'items' | 'equal';
        if (action === 'finalize') next.status = 'finalized';
        if (action === 'share') {
          setNotice('В Telegram здесь появится ссылка-приглашение для друзей.');
          return;
        }
        next.version++;
        next.settlement = calculateSettlement(next);
        apply(next);
      } else {
        const result = await api<SessionView & { url?: string; session?: SessionView }>(
          '/sessions/' + session.id + '/' + action,
          initData,
          { version: session.version, ...payload }
        );
        apply(result.session || result);
        if (result.url) {
          setInvite(result.url);
          telegram?.openTelegramLink(
            'https://t.me/share/url?url=' +
              encodeURIComponent(result.url) +
              '&text=' +
              encodeURIComponent('Разделим чек? Выбери свои блюда в Resplitter.')
          );
        }
      }
      setNotice(
        action === 'selection'
          ? 'Выбор сохранён. Можно вернуться позже.'
          : action === 'finalize'
            ? 'Расчёт завершён. Итог отправляется в бот.'
            : 'Готово'
      );
      telegram?.HapticFeedback?.notificationOccurred('success');
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && ['RECEIPT_NOT_CONFIRMED', 'SESSION_NOT_FOUND', 'SESSION_FORBIDDEN'].includes(e.code)) {
        setSession(undefined);
        setSelected([]);
        setQuantities({});
      }
      if (!preview && e instanceof ApiError && ['SESSION_CONFLICT', 'QUANTITY_EXCEEDED', 'SESSION_FINALIZED'].includes(e.code)) {
        const next = await api<SessionView>('/sessions/' + session.id, initData).catch(() => undefined);
        if (next) {
          if (next.status === 'finalized') apply(next);
          else setSession(next);
        }
      }
    } finally {
      setBusy(false);
      setConfirmFinal(false);
    }
  }

  const money = (minor: number) => formatCurrency(minor, session?.receipt.currency);
  const share = session?.settlement.participants.find((p) => p.userId === session.userId);
  const participants = Object.values(session?.participants || {});
  const badge = final ? 'Расчёт завершён' : session?.status === 'draft' ? 'Проверьте распознавание' : 'Собираем выбор';
  function choose(id: string, quantity?: number) {
    setSelected((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setQuantities((values) => {
      const next = { ...values };
      if (quantity === undefined) delete next[id];
      else next[id] = quantity;
      return next;
    });
  }
  function unchoose(id: string) {
    setSelected((ids) => ids.filter((value) => value !== id));
    setQuantities((values) => Object.fromEntries(Object.entries(values).filter(([key]) => key !== id)));
  }
  return (
    <div className="shell">
      <header className="topbar">
        <a href="/app/" className="brand" aria-label="Resplitter, главная">
          <span className="logo">
            <Icon name="split" size={23} />
          </span>
          resplitter<span className="brand-dot">.</span>
        </a>
        <span className="top-label">ХОРОШАЯ КОМПАНИЯ. ЧЕСТНЫЙ СЧЁТ.</span>
        <span className="secure">
          <span />
          Telegram Mini App
        </span>
      </header>
      {preview && (
        <div className="demo-banner">
          <Icon name="info" size={16} />
          Демо-режим · можно попробовать все действия, реальные чеки не изменяются
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          <Icon name="info" />
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError('')} aria-label="Скрыть ошибку">
            <Icon name="close" />
          </button>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          <Icon name="check" />
          {notice}
        </div>
      )}
      {loading ? (
        <main className="empty">
          <div className="spinner" />
          <h1>Открываем ваш чек</h1>
          <p>Ещё немного — и можно делиться.</p>
        </main>
      ) : !session ? (
        <main className="landing">
          <div className="eyebrow">МЕНЬШЕ ПОДСЧЁТОВ, БОЛЬШЕ ОБЩЕНИЯ</div>
          <h1>
            Хорошо посидели.
            <br />
            <em>Теперь разделим.</em>
          </h1>
          <p className="lead">Каждый отмечает своё. Общие блюда делятся между друзьями, а все копейки сходятся.</p>
          {sessions.length ? (
            <section className="session-list">
              <h2>Ваши чеки</h2>
              {sessions.map((s) => (
                <button key={s.id} className="session-card" onClick={() => void open(s.id)}>
                  <Icon name="receipt" />
                  <span>
                    Чек № {s.number || 'без номера'}
                    <small>{s.status === 'finalized' ? 'Завершён' : 'Открыть и разделить'}</small>
                  </span>
                  <b>{formatCurrency(s.totalMinor, s.currency)}</b>
                  <Icon name="arrow" />
                </button>
              ))}
            </section>
          ) : (
            <div className="welcome-card">
              <span className="paper-icon">
                <Icon name="receipt" size={38} />
              </span>
              <h2>{initData ? 'Здесь пока нет чеков' : 'Начнём с Telegram'}</h2>
              <p>
                {initData
                  ? 'Отправьте боту фотографию или команду /demo. Чек появится здесь.'
                  : 'Откройте приложение кнопкой в боте. Telegram безопасно подтвердит, кто вы.'}
              </p>
              <a className="primary link-button" href="?demo=1">
                Попробовать на примере <Icon name="arrow" />
              </a>
            </div>
          )}
          <div className="steps">
            <span>
              <i>01</i>Загрузите чек в бот
            </span>
            <span>
              <i>02</i>Выберите свои блюда
            </span>
            <span>
              <i>03</i>Получите точный итог
            </span>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <section className="hero">
            <div>
              <div className="eyebrow">ВАШ СТОЛ · ЧЕК № {session.receipt.receiptNumber || '—'}</div>
              <h1>
                {final ? 'Всё сошлось.' : 'Разделим'} {!final && <em>по-честному.</em>}
              </h1>
              <p>{final ? 'Можно возвращаться к приятным разговорам.' : 'Отметьте, что было вашим. С остальным поможем.'}</p>
            </div>
            <span className={'status ' + (final ? 'done' : '')}>
              <span />
              {badge}
            </span>
          </section>
          <div className="board">
            <section className="main-panel">
              <div className="receipt-top">
                <span className="receipt-symbol">
                  <Icon name="receipt" size={24} />
                </span>
                <div>
                  <h2>За нашим столом</h2>
                  <p>
                    {session.receipt.items.length} позиций <span>·</span> {session.receipt.date || 'Сегодня'}
                  </p>
                </div>
                <strong>{money(session.receipt.totalMinor)}</strong>
              </div>
              <div className="tabs" role="tablist" aria-label="Разделы чека">
                {(
                  [
                    ['items', 'Мои блюда'],
                    ['summary', 'Кто сколько'],
                    ['receipt', 'Чек']
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? 'active' : ''}
                    onClick={() => {
                      setTab(id);
                    }}
                  >
                    {label}
                    {id === 'summary' && <span className="tab-count">{participants.length}</span>}
                  </button>
                ))}
              </div>
              {tab === 'items' && (
                <>
                  {session.status === 'draft' ? (
                    <div className="inline-note">
                      <Icon name="info" />
                      <span>
                        Сначала {owner ? 'проверьте и подтвердите чек в чате с ботом.' : 'владелец должен проверить распознавание.'}
                      </span>
                    </div>
                  ) : (
                    <div className="inline-note">
                      <Icon name="users" />
                      <span>
                        {session.splitMode === 'equal'
                          ? 'Весь чек делится поровну между присоединившимися участниками.'
                          : 'Укажите своё количество: например, 2 из 3 напитков. «Делим вместе» делит оставшееся количество поровну между выбравшими этот вариант.'}
                      </span>
                    </div>
                  )}
                  <div className="item-list">
                    {session.receipt.items.map((item, index) => {
                      const picked = selected.includes(item.id);
                      const others = participants.filter((p) => p.userId !== session.userId && p.itemIds.includes(item.id));
                      const disabled = busy || final || session.status === 'draft' || session.splitMode === 'equal';
                      return (
                        <div key={item.id} className={'item ' + (picked ? 'selected' : '') + (disabled ? ' disabled' : '')}>
                          <label className="item-pick">
                            <input
                              type="checkbox"
                              aria-label={'Выбрать ' + item.name}
                              checked={picked}
                              disabled={disabled}
                              onChange={() => {
                                if (picked) unchoose(item.id);
                                else choose(item.id, item.quantity === 1 ? undefined : Math.min(1, item.quantity));
                                telegram?.HapticFeedback?.selectionChanged();
                              }}
                            />
                            <span className="custom-check">{picked && <Icon name="check" size={16} />}</span>
                            <span className="item-index">{String(index + 1).padStart(2, '0')}</span>
                            <span className="item-name">
                              <b>{item.name}</b>
                              <span className="item-meta">
                                {item.quantity} × {money(item.unitPriceMinor)}
                                {others.length > 0 && (
                                  <span className="shared">
                                    <Icon name="users" size={12} />
                                    {others.map((p) => p.displayName + ': ' + (p.itemQuantities?.[item.id] ?? 'делим вместе')).join(', ')}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="item-amount">{money(item.lineTotalMinor)}</span>
                          </label>
                          {picked && (
                            <div className="quantity-controls">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={quantities[item.id] === undefined}
                                  disabled={disabled}
                                  onChange={(e) => choose(item.id, e.target.checked ? undefined : Math.min(1, item.quantity))}
                                />
                                Делим вместе
                              </label>
                              {quantities[item.id] !== undefined && (
                                <label>
                                  Моё количество
                                  <input
                                    className="quantity-input"
                                    type="number"
                                    inputMode="decimal"
                                    min="0.001"
                                    max={item.quantity}
                                    step="0.001"
                                    aria-label={'Моё количество: ' + item.name}
                                    value={Number.isNaN(quantities[item.id]) ? '' : quantities[item.id]}
                                    disabled={disabled}
                                    onChange={(e) => choose(item.id, e.target.valueAsNumber)}
                                  />
                                  из {item.quantity}
                                </label>
                              )}
                              <small>
                                {quantities[item.id] === undefined
                                  ? 'Остаток после точных количеств — поровну между участниками «делим вместе».'
                                  : 'Можно указать часть порции, например 0,5. Цена считается из суммы всей строки.'}
                              </small>
                            </div>
                          )}
                          {(session.settlement.remainingQuantities[item.id] || 0) > 0 && !final && session.splitMode === 'items' && (
                            <small className="quantity-remaining">
                              Ещё не распределено: {session.settlement.remainingQuantities[item.id]} из {item.quantity} (по сохранённому
                              выбору)
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="list-bottom">
                    <span>
                      Позиций выбрано: <b>{selected.length}</b>
                    </span>
                    <button
                      className="text-button"
                      disabled={busy || final || session.status !== 'open' || session.splitMode === 'equal'}
                      onClick={() => {
                        setSelected(selected.length === session.receipt.items.length ? [] : session.receipt.items.map((i) => i.id));
                        setQuantities({});
                      }}
                    >
                      {selected.length === session.receipt.items.length ? 'Снять выбор' : 'Всё делим вместе'}
                    </button>
                  </div>
                </>
              )}
              {tab === 'summary' && (
                <div className="summary-content">
                  <h3>У каждого своя доля</h3>
                  <p className="muted">Расчёт по сохранённому выбору. Общие позиции учитываются один раз.</p>
                  {session.settlement.participants.map((p, i) => (
                    <div className="person-row" key={p.userId}>
                      <span className={'avatar avatar-' + (i % 4)}>{p.displayName.slice(0, 1)}</span>
                      <div>
                        <b>{p.userId === session.userId ? 'Вы' : p.displayName}</b>
                        <small>
                          {session.splitMode === 'equal'
                            ? 'Поровну'
                            : (session.participants[String(p.userId)]?.itemIds.length || 0) + ' позиций'}
                          {p.adjustmentMinor !== 0 ? ' · корректировка ' + money(p.adjustmentMinor) : ''}
                        </small>
                        {session.splitMode === 'items' && (
                          <small className="person-items">
                            {session.receipt.items
                              .filter((item) => session.participants[String(p.userId)]?.itemIds.includes(item.id))
                              .map(
                                (item) =>
                                  item.name + ' × ' + (session.participants[String(p.userId)].itemQuantities?.[item.id] ?? 'общая доля')
                              )
                              .join(' · ')}
                          </small>
                        )}
                      </div>
                      <strong>{money(p.totalMinor)}</strong>
                    </div>
                  ))}
                  {!participants.length && <p>Пригласите участников, чтобы начать.</p>}
                  <div className="summary-total">
                    <span>Общий счёт</span>
                    <b>{money(session.receipt.totalMinor)}</b>
                  </div>
                </div>
              )}
              {tab === 'receipt' && (
                <div className="summary-content">
                  <div className="section-heading">
                    <h3>Подтверждённый чек</h3>
                    {owner && !final && session.reviewUrl && (
                      <a
                        className="text-button"
                        href={session.reviewUrl}
                        onClick={(event) => {
                          if (telegram) {
                            event.preventDefault();
                            telegram.openTelegramLink(session.reviewUrl);
                          }
                        }}
                      >
                        Исправить в боте
                      </a>
                    )}
                  </div>
                  <p className="fine-print">
                    Проверка и исправления — в чате с ботом. После правок чек нужно подтвердить заново; выбор участников сбросится.
                  </p>
                  <>
                    {session.receipt.items.map((i) => (
                      <div className="receipt-line" key={i.id}>
                        <span>
                          {i.name}
                          <small>
                            {i.quantity} × {money(i.unitPriceMinor)}
                          </small>
                        </span>
                        <b>{money(i.lineTotalMinor)}</b>
                      </div>
                    ))}
                    <div className="receipt-line">
                      <span>Сумма позиций</span>
                      <b>{money(session.receipt.subtotalMinor)}</b>
                    </div>
                    {session.settlement.adjustmentMinor !== 0 && (
                      <div className="receipt-line">
                        <span>Скидки / сервис / корректировка</span>
                        <b>{money(session.settlement.adjustmentMinor)}</b>
                      </div>
                    )}
                    <div className="summary-total">
                      <span>Итого по чеку</span>
                      <b>{money(session.receipt.totalMinor)}</b>
                    </div>
                    {session.receipt.warnings.map((w, i) => (
                      <p className="warning" key={i}>
                        <Icon name="info" size={16} />
                        {w}
                      </p>
                    ))}
                  </>
                </div>
              )}
            </section>
            <aside className="side-panel">
              <div className="share-card">
                <div className="eyebrow">ВАША ДОЛЯ</div>
                <div className="your-amount">{money(share?.totalMinor || 0)}</div>
                <p>
                  {dirty
                    ? 'Есть несохранённые изменения'
                    : session.settlement.unassignedItemIds.length
                      ? 'Предварительно · выбор ещё идёт'
                      : 'Все позиции распределены'}
                </p>
                <div className="mini-rule" />
                <div className="detail">
                  <span>За столом</span>
                  <b>{participants.length} чел.</b>
                </div>
                <div className="detail">
                  <span>Всего в чеке</span>
                  <b>{money(session.receipt.totalMinor)}</b>
                </div>
                {session.settlement.unassignedItemIds.length > 0 && (
                  <div className="remaining">
                    <Icon name="info" size={16} />
                    <span>
                      Не распределено {money(session.settlement.unassignedMinor)}
                      <small>{session.settlement.unassignedItemIds.length} позиций ждут выбора</small>
                    </span>
                  </div>
                )}
                {session.settlement.adjustmentMinor !== 0 && (
                  <p className="fine-print">
                    Корректировка {money(session.settlement.adjustmentMinor)} распределяется пропорционально долям после выбора всех
                    позиций.
                  </p>
                )}
                <button
                  className="primary full"
                  disabled={busy || final || session.status !== 'open' || !dirty || session.splitMode === 'equal'}
                  onClick={() => void mutate('selection', { itemIds: selected, itemQuantities: quantities })}
                >
                  {busy ? 'Сохраняем…' : dirty ? 'Сохранить выбор' : 'Выбор сохранён'}
                  <Icon name={dirty ? 'arrow' : 'check'} />
                </button>
              </div>
              <div className="people-card">
                <div className="section-heading">
                  <h3>Вместе проще</h3>
                  <div className="avatar-stack">
                    {participants.slice(0, 4).map((p, i) => (
                      <span key={p.userId} className={'avatar avatar-' + (i % 4)}>
                        {p.displayName.slice(0, 1)}
                      </span>
                    ))}
                  </div>
                </div>
                <p>Пригласите друзей — каждый выберет блюда со своего телефона.</p>
                <details className="group-guide">
                  <summary>Как разделить чек компанией?</summary>
                  <ol>
                    <li>Один человек загружает фото, проверяет все страницы в боте и подтверждает чек.</li>
                    <li>Владелец нажимает «Пригласить друзей» и отправляет ссылку в общий чат.</li>
                    <li>
                      Каждый открывает ссылку в своём Telegram, запускает бота и выбирает позиции в Mini App. Ссылка общая, выбор у каждого
                      свой.
                    </li>
                    <li>Укажите количество, например 2 пива. Для общей пиццы выберите «Делим вместе». Нажмите «Сохранить выбор».</li>
                    <li>
                      Вкладка «Кто сколько» показывает сохранённые доли. Когда все готовы и остаток распределён, владелец завершает расчёт.
                    </li>
                  </ol>
                  <p>
                    Можно отправить фото сразу в Telegram-группу с ботом. Участники переходят по кнопке в личный чат с ботом, а итог
                    возвращается в исходную группу. Подробности и настройка группы: /group в боте.
                  </p>
                  <p>
                    При одновременной правке приложение предложит проверить обновлённый чек и сохранить ещё раз. Ваш несохранённый выбор не
                    заменяется чужим.
                  </p>
                </details>
                {owner && !final && (
                  <button className="secondary full" disabled={busy || dirty} onClick={() => void mutate('share')}>
                    <Icon name="share" size={17} />
                    Пригласить друзей
                  </button>
                )}
                {invite && (
                  <a className="invite-link" href={invite}>
                    Ссылка для приглашения
                  </a>
                )}
                {owner && !final && (
                  <fieldset className="mode">
                    <legend>Как делим?</legend>
                    <label>
                      <input
                        type="radio"
                        name="mode"
                        checked={session.splitMode === 'items'}
                        disabled={busy || dirty}
                        onChange={() => void mutate('mode', { mode: 'items' })}
                      />
                      По блюдам
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="mode"
                        checked={session.splitMode === 'equal'}
                        disabled={busy || dirty}
                        onChange={() => void mutate('mode', { mode: 'equal' })}
                      />
                      Поровну
                    </label>
                  </fieldset>
                )}
              </div>
              {owner && !final && (
                <button
                  className="finish"
                  disabled={busy || dirty || !session.settlement.canFinalize}
                  onClick={() => setConfirmFinal(true)}
                >
                  Завершить и отправить итог <Icon name="arrow" size={16} />
                </button>
              )}
              <p className="retention">
                <Icon name="receipt" size={14} />
                Чек доступен до{' '}
                {new Date(session.expiresAt).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </aside>
          </div>
          <footer className="footer">
            <span>Считаем до копейки.</span>
            <span>
              Хорошего вечера <span className="leaf">✳</span>
            </span>
          </footer>
        </main>
      )}
      {dirty && session?.status === 'open' && session.splitMode === 'items' && (
        <div className="mobile-save">
          <button
            className="primary full"
            disabled={busy}
            onClick={() => void mutate('selection', { itemIds: selected, itemQuantities: quantities })}
          >
            {busy ? 'Сохраняем…' : 'Сохранить выбор'} <Icon name="check" />
          </button>
        </div>
      )}
      {confirmFinal && <FinalConfirmation busy={busy} onConfirm={() => void mutate('finalize')} onCancel={() => setConfirmFinal(false)} />}
    </div>
  );
}
function FinalConfirmation({ busy, onConfirm, onCancel }: { busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      className="modal"
      ref={dialog}
      aria-labelledby="final-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <span className="paper-icon">
        <Icon name="check" size={32} />
      </span>
      <h2 id="final-title">Все готовы?</h2>
      <p>После завершения выбор будет закрыт. Итоговый расчёт отправится в чат с ботом.</p>
      <button className="primary full" disabled={busy} onClick={onConfirm}>
        Да, завершить расчёт
      </button>
      <button className="secondary full" disabled={busy} onClick={onCancel}>
        Ещё проверим
      </button>
    </dialog>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
