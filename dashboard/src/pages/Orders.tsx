import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { watomatisOrdersApi, type WatomatisOrder } from '../services/api';
import './Orders.css';

const STATUS_LABEL: Record<WatomatisOrder['status'], string> = {
  collecting: 'Mengumpulkan',
  ready: 'Siap kirim',
  booked: 'Terkirim',
  failed: 'Gagal',
};

export default function Orders() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<WatomatisOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  const load = () => watomatisOrdersApi.list().then(setOrders).catch(e => setError(String(e)));
  useEffect(() => {
    load();
  }, []);

  const book = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await watomatisOrdersApi.book(id);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await watomatisOrdersApi.remove(id);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="orders-page">
      <h1>{t('nav.orders')}</h1>
      {error && <div className="orders-error">{error}</div>}
      {orders.length === 0 && <p className="orders-empty">Belum ada order tertangkap.</p>}
      <div className="orders-list">
        {orders.map(o => (
          <div key={o.id} className={`order-card status-${o.status}`}>
            <div className="order-head">
              <strong>{o.customerName || '(tanpa nama)'}</strong>
              <span className={`order-badge ${o.status}`}>{STATUS_LABEL[o.status]}</span>
            </div>
            <div className="order-body">
              <div>{o.phone}</div>
              <div>{[o.address, o.city, o.postalCode].filter(Boolean).join(', ')}</div>
              <div>
                {o.items.map(i => `${i.ref} x${i.quantity}`).join(', ')} · {o.paymentMethod?.toUpperCase()}
              </div>
              {o.scalevOrderId && <div className="order-ref">Scalev: {o.scalevOrderId}</div>}
              {o.lastError && <div className="order-err">{o.lastError}</div>}
            </div>
            <div className="order-actions">
              {o.status === 'ready' && (
                <button disabled={busy === o.id} onClick={() => book(o.id)}>
                  {busy === o.id ? '...' : 'Kirim ke Scalev'}
                </button>
              )}
              <button className="ghost" disabled={busy === o.id} onClick={() => remove(o.id)}>
                Hapus
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
