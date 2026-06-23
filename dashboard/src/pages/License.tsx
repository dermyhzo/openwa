import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, CheckCircle, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { licenseApi, type LicenseStatus } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './License.css';

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
      const data = await licenseApi.getStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

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

  const formatValidUntil = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

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
            <div className={`license-status-card ${status.active ? 'license-status-card--active' : ''}`}>
              <div className="license-status-icon">
                <CreditCard size={24} />
              </div>
              <div className="license-status-body">
                <p className="license-status-label">
                  {t('license.statusLabel')}
                </p>
                {status.active ? (
                  <div className="license-status-active">
                    <CheckCircle size={16} className="license-check-icon" />
                    <span className="license-badge license-badge--active">
                      {t('license.active')}
                    </span>
                    {status.validUntil && (
                      <span className="license-valid-until">
                        {t('license.validUntil', { date: formatValidUntil(status.validUntil) })}
                      </span>
                    )}
                    {status.plan && status.plans[status.plan] && (
                      <span className="license-current-plan">
                        · {status.plans[status.plan].label}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="license-status-inactive">{t('license.inactive')}</p>
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
              {Object.entries(status.plans).map(([key, plan]) => (
                <div key={key} className="license-plan-card">
                  <div className="license-plan-header">
                    <span className="license-plan-label">{plan.label}</span>
                  </div>
                  <div className="license-plan-price">
                    Rp {plan.price.toLocaleString('id-ID')}
                  </div>
                  <div className="license-plan-duration">
                    / {plan.durationDays} {t('license.days')}
                  </div>
                  <button
                    className="license-pay-btn"
                    onClick={() => void handlePay(key)}
                    disabled={payLoading === key}
                  >
                    {payLoading === key ? (
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
