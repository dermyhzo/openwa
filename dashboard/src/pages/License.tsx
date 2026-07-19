import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, CheckCircle, Loader2, AlertCircle, ExternalLink, Star, KeyRound } from 'lucide-react';
import { licenseApi } from '../services/api';
import type { LicenseStatus } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './License.css';

// Single offering: Watomatis Lifetime. Payment goes through Scalev (external checkout);
// after paying, the buyer receives a signed license key (WTM1...) on WhatsApp and pastes it below.
const SCALEV_CHECKOUT_URL = 'https://payment.inautomode.com/p/watomatis';
const PLAN = { label: 'Lifetime', price: 99_000, duration: 'sekali bayar / seumur hidup' } as const;

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
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

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

  const openCheckout = () => window.open(SCALEV_CHECKOUT_URL, '_blank', 'noopener');

  const activate = async () => {
    if (!licenseKey.trim() || activating) return;
    setActivating(true);
    setActivateError(null);
    setActivated(false);
    try {
      const next = await licenseApi.activate(licenseKey.trim());
      setStatus(next);
      setActivated(true);
      setLicenseKey('');
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setActivating(false);
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
                    {status.issuedTo && (
                      <span className="license-valid-until">{t('license.issuedTo', { phone: status.issuedTo })}</span>
                    )}
                  </div>
                ) : (
                  <p className="license-status-inactive">{statusText}</p>
                )}
              </div>
            </div>

            {/* Activation card: paste the WTM1... key received on WhatsApp after purchase */}
            {!status.active && (
              <div className="license-status-card">
                <div className="license-status-icon">
                  <KeyRound size={24} />
                </div>
                <div className="license-status-body">
                  <p className="license-status-label">{t('license.activateLabel')}</p>
                  <div className="license-activate-row">
                    <input
                      className="license-activate-input"
                      value={licenseKey}
                      onChange={e => setLicenseKey(e.target.value)}
                      placeholder={t('license.activatePlaceholder')}
                      spellCheck={false}
                    />
                    <button
                      className="license-pay-btn"
                      onClick={() => void activate()}
                      disabled={activating || !licenseKey.trim()}
                    >
                      {activating ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                      {t('license.activateBtn')}
                    </button>
                  </div>
                  <p className="license-status-inactive">{t('license.activateHint')}</p>
                  {activateError && (
                    <div className="error-banner">
                      <AlertCircle size={16} />
                      <span className="error-banner-text">{activateError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activated && (
              <div className="license-status-card license-status-card--active">
                <div className="license-status-icon">
                  <CheckCircle size={24} />
                </div>
                <div className="license-status-body">
                  <p className="license-status-label">{t('license.activatedTitle')}</p>
                  <p className="license-status-inactive">{t('license.activatedBody')}</p>
                </div>
              </div>
            )}

            {/* Single plan card */}
            {!status.active && (
              <div className="license-plans license-plans--single">
                <div className="license-plan-card license-plan-card--featured">
                  <div className="license-plan-badge">
                    <Star size={12} />
                    {t('license.bestValue')}
                  </div>
                  <div className="license-plan-header">
                    <span className="license-plan-label">{PLAN.label}</span>
                  </div>
                  <div className="license-plan-price">{formatRp(PLAN.price)}</div>
                  <div className="license-plan-duration">{PLAN.duration}</div>
                  <button className="license-pay-btn" onClick={openCheckout}>
                    <ExternalLink size={15} />
                    {t('license.payBtn')}
                  </button>
                  <p className="license-status-inactive">{t('license.afterPayHint')}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
