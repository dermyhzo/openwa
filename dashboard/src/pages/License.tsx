import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, CheckCircle, Loader2, AlertCircle, ExternalLink, Star } from 'lucide-react';
import { licenseApi } from '../services/api';
import type { LicenseStatus } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './License.css';

// ponytail: plans are hardcoded here; if backend ever drives them, move to API response
const PLANS = [
  { key: 'monthly',   label: 'Bulanan',  price: 25_000,  duration: '30 hari',              featured: false },
  { key: 'sixmonth',  label: '6 Bulan',  price: 125_000, duration: '180 hari',             featured: false },
  { key: 'yearly',    label: 'Tahunan',  price: 200_000, duration: '365 hari',             featured: false },
  { key: 'lifetime',  label: 'Lifetime', price: 499_000, duration: 'sekali bayar / seumur hidup', featured: true },
] as const;

function formatRp(n: number) {
  return 'Rp' + n.toLocaleString('id-ID');
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function License() {
  const { t } = useTranslation();
  useDocumentTitle(t('license.title'));

  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [payLoading, setPayLoading] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await licenseApi.getStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  const handlePay = async (planKey: string) => {
    setPayLoading(planKey);
    setPayError(null);
    try {
      const result = await licenseApi.pay(planKey, email || undefined);
      window.open(result.paymentUrl, '_blank');
    } catch (err) {
      setPayError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setPayLoading(null);
    }
  };

  const statusText = (() => {
    if (!status) return null;
    if (!status.active) return t('license.inactive');
    if (status.lifetime) return t('license.statusLifetime');
    if (status.expiresAt) return t('license.validUntil', { date: formatDate(status.expiresAt) });
    return t('license.active');
  })();

  return (
    <div className="license-page">
      <PageHeader title={t('license.title')} subtitle={t('license.subtitle')} />

      <div className="license-content">
        {loading && (
          <div className="license-loading">
            <Loader2 size={24} className="animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        )}

        {error && (
          <div className="error-banner">
            <AlertCircle size={18} />
            <span className="error-banner-text">{error}</span>
          </div>
        )}

        {!loading && status && (
          <>
            {/* Status card */}
            <div className={`license-status-card${status.active ? ' license-status-card--active' : ''}`}>
              <div className="license-status-icon">
                <CreditCard size={24} />
              </div>
              <div className="license-status-body">
                <p className="license-status-label">{t('license.statusLabel')}</p>
                {status.active ? (
                  <div className="license-status-active">
                    <CheckCircle size={16} className="license-check-icon" />
                    <span className="license-badge license-badge--active">{t('license.active')}</span>
                    <span className="license-valid-until">{statusText}</span>
                  </div>
                ) : (
                  <p className="license-status-inactive">{statusText}</p>
                )}
              </div>
            </div>

            {/* Email input */}
            <div className="license-email-row">
              <label className="license-email-label" htmlFor="license-email">
                {t('license.emailLabel')}
              </label>
              <input
                id="license-email"
                type="email"
                className="license-email-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('license.emailPlaceholder')}
              />
            </div>

            {payError && (
              <div className="error-banner">
                <AlertCircle size={18} />
                <span className="error-banner-text">{payError}</span>
              </div>
            )}

            {/* Plan cards */}
            <div className="license-plans">
              {PLANS.map(plan => (
                <div key={plan.key} className={`license-plan-card${plan.featured ? ' license-plan-card--featured' : ''}`}>
                  {plan.featured && (
                    <div className="license-plan-badge">
                      <Star size={12} />
                      {t('license.bestValue')}
                    </div>
                  )}
                  <div className="license-plan-header">
                    <span className="license-plan-label">{plan.label}</span>
                  </div>
                  <div className="license-plan-price">{formatRp(plan.price)}</div>
                  <div className="license-plan-duration">{plan.duration}</div>
                  <button
                    className="license-pay-btn"
                    onClick={() => void handlePay(plan.key)}
                    disabled={payLoading === plan.key}
                  >
                    {payLoading === plan.key ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <ExternalLink size={15} />
                    )}
                    {t('license.payBtn')}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
