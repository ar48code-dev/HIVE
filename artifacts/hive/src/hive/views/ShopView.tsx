import { useEffect, useRef, useState } from 'react';
import { emit } from '../motion/bus';
import { api, money, post, type AppConfig, type SimResult } from '../api';

declare global { interface Window { paypal?: any } }

const PRODUCTS = [
  { id: 'sandbox', name: 'Sandbox test item', amount: '1.00' },
  { id: 'starter', name: 'Starter pack', amount: '5.00' },
  { id: 'pro', name: 'Pro pack', amount: '25.00' },
  { id: 'bundle', name: 'Studio bundle', amount: '120.00' },
];

export function ShopView({ demo, onChanged }: { demo: boolean; onChanged: () => Promise<void> }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [product, setProduct] = useState(PRODUCTS[0]!);
  const [msg, setMsg] = useState<string | null>(null);
  const [captured, setCaptured] = useState<{ orderId: string; captureId: string; amount: string } | null>(null);
  const [pending, setPending] = useState<{ orderId: string; amount: string } | null>(null);
  const [checkoutStarted, setCheckoutStarted] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const approvedOrder = useRef<string | null>(null);
  const checkoutRequestId = useRef<string | null>(null);
  const checkoutAmount = useRef(product.amount);
  const [sdk, setSdk] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const box = useRef<HTMLDivElement>(null);
  const amount = useRef(product.amount);
  amount.current = product.amount;

  useEffect(() => { api<AppConfig>('/api/config').then(setCfg).catch((e: Error) => setMsg(e.message)); }, []);

  // Load PayPal's checkout buttons once we know the (public) client id.
  useEffect(() => {
    if (!cfg || cfg.demo || !cfg.paypalClientId) return;
    if (window.paypal) { setSdk('ready'); return; }
    setSdk('loading');
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.paypalClientId)}&currency=${cfg.currency}&intent=capture&components=buttons`;
    s.onload = () => setSdk('ready');
    s.onerror = () => setSdk('failed');
    document.head.appendChild(s);
  }, [cfg]);

  useEffect(() => {
    if (sdk !== 'ready' || !box.current || !window.paypal) return;
    box.current.innerHTML = '';
    window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'rect', label: 'pay' },
      createOrder: async () => {
        const requestId = checkoutRequestId.current ?? window.crypto.randomUUID();
        checkoutRequestId.current = requestId;
        checkoutAmount.current = amount.current;
        setCheckoutStarted(true);
        return (await post<{ id: string }>('/api/checkout/create', { amount: checkoutAmount.current, requestId })).id;
      },
      onApprove: async (data: { orderID: string }) => {
        if (approvedOrder.current) return;
        approvedOrder.current = data.orderID;
        setCheckoutStarted(false);
        setPending({ orderId: data.orderID, amount: checkoutAmount.current });
        await syncCapture(data.orderID, checkoutAmount.current);
      },
      onCancel: () => {
        if (approvedOrder.current) return;
        checkoutRequestId.current = null;
        setCheckoutStarted(false);
        setMsg('Checkout was closed before approval. HIVE did not request a capture.');
      },
      onError: (e: unknown) => {
        if (approvedOrder.current) {
          setMsg(`PayPal approval was received, but capture status is unclear. Do not create another order. Check the same order ${approvedOrder.current} in Sandbox.`);
        } else {
          setCheckoutStarted(false);
          setMsg(`PayPal reported a problem: ${String((e as Error)?.message ?? e)}`);
        }
      },
    }).render(box.current);
  }, [sdk]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulate = async () => {
    setMsg(null);
    try {
      const r = await post<SimResult>('/api/demo/simulate', { attack: 'normal_payment' });
      setMsg(`A simulated ${money(Math.round(Number(product.amount) * 100))}-style payment arrived (${r.transactions} transaction). Check the Hive screen.`);
      await onChanged();
      emit('payment', { count: 1 });
    } catch (e) { setMsg((e as Error).message); }
  };

  const syncCapture = async (orderId: string, expectedAmount: string) => {
    setSyncing(true);
    try {
      const r = await post<{ status: string; recorded: boolean; captureId?: string; amount?: string; currency?: string; orderId?: string; message?: string }>(
        '/api/checkout/capture', { orderId },
      );
      if (r.status === 'COMPLETED' && r.recorded && r.captureId) {
        setCaptured({ orderId, captureId: r.captureId, amount: r.amount ?? expectedAmount });
        setPending(null);
        checkoutRequestId.current = null;
        setMsg(`Captured and recorded in HIVE: $${Number(r.amount ?? expectedAmount).toFixed(2)} USD. The PayPal event is deduplicated if its webhook arrives later.`);
        approvedOrder.current = null;
        await onChanged();
      } else if (r.status === 'COMPLETED') {
        setPending({ orderId, amount: expectedAmount });
        setMsg(r.message ?? 'PayPal reports this payment captured, but HIVE has not confirmed its transaction record. Do not create another order; retry syncing this same order.');
      } else {
        setPending({ orderId, amount: expectedAmount });
        setMsg(`PayPal order status is ${r.status}. No completed capture is recorded. Do not create a new order while this one is unresolved.`);
      }
    } catch (e) {
      setPending({ orderId, amount: expectedAmount });
      setMsg(`Order ${orderId}: HIVE could not confirm capture status. Do not create another order; check this same order or retry its sync.`);
    } finally { setSyncing(false); }
  };

  return (
    <section className="panel shop" aria-labelledby="s-h">
      <h2 id="s-h">{demo ? 'Demo shop' : 'Sandbox checkout'}</h2>
      <p className="muted">{demo
        ? 'Synthetic activity only; no PayPal calls or money movement.'
        : 'Opt-in PayPal Sandbox test. HIVE records the verified capture directly and deduplicates the later signed webhook.'}</p>

      <fieldset className="products" disabled={checkoutStarted || Boolean(pending) || Boolean(captured)}>
        <legend>Choose a product</legend>
        {PRODUCTS.map((p) => (
          <label key={p.id} className={product.id === p.id ? 'on' : ''}>
            <input type="radio" name="product" checked={product.id === p.id} onChange={() => { checkoutRequestId.current = null; setProduct(p); }} />
            <span>{p.name}</span><strong>{money(Math.round(Number(p.amount) * 100))}</strong>
          </label>
        ))}
      </fieldset>

      {demo || cfg?.demo ? (
        <div className="notice warn">
          <p><strong>Checkout is switched off in demo mode.</strong> Connect a PayPal sandbox app (see the README) to take a real sandbox payment here. Until then you can simulate a normal payment arriving.</p>
          <button className="primary" onClick={() => void simulate()}>Simulate a payment</button>
        </div>
      ) : (
        <>
          {sdk === 'loading' && <p className="muted">Loading PayPal…</p>}
          {sdk === 'failed' && <p className="notice error" role="alert">Could not load the PayPal checkout. Check the client id in your environment and your network connection.</p>}
          {cfg && !cfg.paypalClientId && <p className="notice error" role="alert">No PayPal client id is configured on the server.</p>}
          {!captured && !pending && <div ref={box} className="paypal-box" aria-label="PayPal checkout buttons" />}
          {pending && <div className="notice warn" role="status">
            <p><strong>Order needs confirmation.</strong> Do not create another order.</p>
            <p>Order {pending.orderId} · ${Number(pending.amount).toFixed(2)} USD</p>
            <button className="primary" disabled={syncing} onClick={() => void syncCapture(pending.orderId, pending.amount)}>
              {syncing ? 'Checking the same order…' : 'Check / sync this same order'}
            </button>
          </div>}
          {captured && <div className="notice success" role="status" aria-live="polite">
            <h3>Payment captured in Sandbox</h3>
            <p>${Number(captured.amount).toFixed(2)} USD · Order {captured.orderId}</p>
            <p>Capture {captured.captureId}</p>
            <p>Recorded in HIVE. No real money moved.</p>
          </div>}
          <p className="muted small">Sandbox only. Pay with a sandbox personal account, never a real card.</p>
        </>
      )}
      {msg && <p className="toast inline" role="status" aria-live="polite">{msg}</p>}
    </section>
  );
}
