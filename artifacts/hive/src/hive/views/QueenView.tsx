import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { api, money, post, type QueenAnswer } from '../api';
import type { Focus, QueenSeed } from '../App';

export interface Turn { question: string; answer?: QueenAnswer; error?: string; pending?: boolean }

const FALLBACK_SUGGESTIONS = [
  'Is anything suspicious right now?',
  'Who is my biggest customer and how concentrated is my revenue?',
  'What is my refund rate and who is getting refunds?',
  'How much did PayPal fees cost me, and what did I keep?',
  'Write my weekly report',
  'Give me my daily summary',
  'Forecast my income for next month',
];

interface Props {
  seed: QueenSeed | null; turns: Turn[]; setTurns: Dispatch<SetStateAction<Turn[]>>;
  onSeedUsed: () => void; onShow: (f: Focus) => void; onChanged: () => Promise<void>;
}

export function QueenView({ seed, turns, setTurns, onSeedUsed, onShow, onChanged }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS);
  useEffect(() => { api<string[]>('/api/queen/suggestions').then((s) => setSuggestions([...s, 'Forecast my income for next month'])).catch(() => undefined); }, []);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const ask = async (question: string, alertId?: number) => {
    const q = question.trim();
    if (!q) return;
    setTurns((t) => [...t, { question: q, pending: true }]);
    setText('');
    try {
      const answer = await post<QueenAnswer>('/api/queen/ask', { question: q, alertId });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { question: q, answer } : x)));
      void onChanged();
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { question: q, error: (e as Error).message } : x)));
    }
  };

  // A question sent from an alert runs once, then is cleared so returning to this tab never re-asks it.
  useEffect(() => {
    if (seed) { onSeedUsed(); void ask(seed.question, seed.alertId); }
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns]);

  return (
    <section className="panel queen" aria-labelledby="q-h">
      <h2 id="q-h">Ask Queen AI</h2>
      <p className="muted">Queen answers only from your transactions. Every claim links to the payments behind it, and answers that cite anything else are thrown out.</p>

      <div className="chips">
        {suggestions.map((s) => <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>)}
      </div>

      <div className="thread" aria-live="polite">
        {turns.length === 0 && <p className="muted pad">Pick a question above or write your own. Try the forecast one to see how Queen refuses when it cannot back an answer.</p>}
        {turns.map((t, i) => (
          <article key={i} className="turn">
            <p className="you">{t.question}</p>
            {t.pending && <p className="muted">Queen is checking the transactions…</p>}
            {t.error && <p className="notice error">{t.error}</p>}
            {t.answer && <Answer a={t.answer} onShow={onShow} />}
          </article>
        ))}
        <div ref={end} />
      </div>

      <form className="ask" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <label htmlFor="q-in" className="sr">Your question</label>
        <input id="q-in" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Ask about revenue, refunds, customers or an alert" />
        <button className="primary" type="submit" disabled={!text.trim()}>Ask</button>
      </form>
    </section>
  );
}

function Answer({ a, onShow }: { a: QueenAnswer; onShow: (f: Focus) => void }) {
  const byId = new Map(a.evidence.map((e) => [e.id, e]));
  const v = a.validation;
  return (
    <div className={`answer ${a.insufficientData ? 'insufficient' : ''}`}>
      {a.insufficientData && <p className="tag">Not enough to answer</p>}
      <p className="lead">{a.answer}</p>
      {a.claims.length > 0 && (
        <ol className="claims">
          {a.claims.map((c, i) => (
            <li key={i}>
              <p>{c.text}</p>
              <div className="ev">
                {c.evidenceIds.slice(0, 6).map((id) => {
                  const e = byId.get(id);
                  return (
                    <button key={id} className="ev-chip" onClick={() => onShow({ ids: c.evidenceIds, label: 'Transactions cited by Queen AI' })} title={id}>
                      {e ? `${e.kind === 'refund' ? 'Refund' : e.kind === 'failed' ? 'Failed' : 'Payment'} ${money(e.amountCents)}` : id}
                    </button>
                  );
                })}
                {c.evidenceIds.length > 6 && <button className="ev-chip" onClick={() => onShow({ ids: c.evidenceIds, label: 'Transactions cited by Queen AI' })}>+{c.evidenceIds.length - 6} more</button>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="check" role="note">
        {a.insufficientData
          ? 'Queen declined instead of guessing.'
          : `Checked ${v.checkedClaims} ${v.checkedClaims === 1 ? 'claim' : 'claims'} against ${v.checkedTransactions} ${v.checkedTransactions === 1 ? 'transaction' : 'transactions'}.`}{' '}
        {a.insufficientData ? '' : ` Confidence: ${a.confidence}.`} {a.mode === 'template' ? 'Written from rule-based templates.' : a.mode === 'recorded' ? 'Recorded answer from an earlier real model run, re-checked against today’s data. The live model was unavailable.' : 'Written by the model and verified.'}
        {v.retried && !v.fellBack && ' The first draft failed the checks, so Queen tried again.'}
        {v.fellBack && ` The model’s draft was rejected (${v.issues[0] ?? 'failed checks'}), so this answer comes from rules instead.`}
      </p>
      {a.evidence.some((e) => e.injectionSuspected) && <p className="notice warn">One cited transaction contains text that looks like an instruction. HIVE treated it as data and ignored it.</p>}
    </div>
  );
}
