import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Loader2, AlertCircle } from 'lucide-react';
import { watomatisSettingsApi, watomatisApi, type VillageItem } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './AiAgent.css';
import './Shipping.css';

export default function Shipping() {
  const { t } = useTranslation();
  useDocumentTitle(t('shipping.title'));

  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [originVillageCode, setOriginVillageCode] = useState('');
  const [originLabel, setOriginLabel] = useState('');
  const [defaultWeightKg, setDefaultWeightKg] = useState(1);
  const [originQuery, setOriginQuery] = useState('');
  const [villageResults, setVillageResults] = useState<VillageItem[]>([]);
  const [searchingVillage, setSearchingVillage] = useState(false);
  const [villageSearchError, setVillageSearchError] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    watomatisSettingsApi.getSettings()
      .then(data => {
        setEnabled(data.shipping.enabled);
        setApiKey(data.shipping.apiKey);
        setOriginVillageCode(data.shipping.originVillageCode);
        setOriginLabel(data.shipping.originLabel ?? '');
        setDefaultWeightKg(data.shipping.defaultWeightKg);
      })
      .catch(err => {
        setLoadError(err instanceof Error ? err.message : t('common.unknownError'));
      });
  }, [t]);

  const handleSearchVillages = async () => {
    if (!apiKey.trim() || !originQuery.trim()) return;
    setSearchingVillage(true);
    setVillageSearchError(null);
    setVillageResults([]);
    try {
      const res = await watomatisApi.searchVillages(apiKey.trim(), originQuery.trim());
      setVillageResults(res.items);
    } catch (err) {
      setVillageSearchError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setSearchingVillage(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);
    try {
      await watomatisSettingsApi.saveSettings({
        shipping: {
          enabled,
          apiKey: apiKey.trim(),
          originVillageCode,
          originLabel: originLabel || undefined,
          defaultWeightKg: Number(defaultWeightKg) || 1,
        },
      });
      setSaveSuccess(t('shipping.saveSuccess'));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ai-agent-page">
      <PageHeader title={t('shipping.title')} subtitle={t('shipping.subtitle')} />

      <div className="ai-agent-content">
        <div className="ai-agent-card">
          <h2 className="ai-agent-section-title">
            <Truck size={18} />
            {t('shipping.sectionTitle')}
          </h2>

          {loadError && (
            <div className="error-banner" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={18} />
              <span className="error-banner-text">{loadError}</span>
            </div>
          )}

          <div className="form-group">
            <label className="shipping-inline-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
                className="shipping-checkbox"
              />
              {t('shipping.enabledLabel')}
            </label>
          </div>

          <div className="form-group">
            <label>{t('shipping.apiKeyLabel')}</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="api.co.id key"
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label>{t('shipping.originLabel')}</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={originQuery}
                onChange={e => setOriginQuery(e.target.value)}
                placeholder={t('shipping.originSearchPlaceholder')}
                onKeyDown={e => { if (e.key === 'Enter') void handleSearchVillages(); }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleSearchVillages()}
                disabled={searchingVillage || !apiKey.trim() || !originQuery.trim()}
                style={{ flexShrink: 0 }}
              >
                {searchingVillage ? <Loader2 size={14} className="animate-spin" /> : null}
                {t('shipping.searchBtn')}
              </button>
            </div>

            {villageSearchError && (
              <small style={{ color: 'var(--color-error, #ef4444)' }}>{villageSearchError}</small>
            )}

            {villageResults.length > 0 && (
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '160px', overflowY: 'auto' }}>
                {villageResults.map(v => (
                  <button
                    key={v.code}
                    type="button"
                    onClick={() => {
                      setOriginVillageCode(v.code);
                      setOriginLabel(`${v.name}, ${v.regency}`);
                      setVillageResults([]);
                      setOriginQuery('');
                    }}
                    style={{ textAlign: 'left', background: 'var(--bg-secondary, #f9fafb)', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: '4px', padding: '0.35rem 0.6rem', cursor: 'pointer', fontSize: '0.875rem' }}
                  >
                    {v.name}, {v.regency}
                  </button>
                ))}
              </div>
            )}

            {originVillageCode && (
              <small style={{ color: 'var(--color-success, #22c55e)', marginTop: '0.25rem', display: 'block' }}>
                {t('shipping.originSelected')}: {originLabel} ({originVillageCode})
              </small>
            )}
          </div>

          <div className="form-group">
            <label>{t('shipping.weightLabel')}</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={defaultWeightKg}
              onChange={e => setDefaultWeightKg(Number(e.target.value))}
            />
          </div>

          {saveSuccess && (
            <div className="ai-agent-activate-success" style={{ marginBottom: '1rem' }}>
              {saveSuccess}
            </div>
          )}

          {saveError && (
            <div className="error-banner" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={18} />
              <span className="error-banner-text">{saveError}</span>
            </div>
          )}

          <div className="ai-agent-actions">
            <button
              className="btn-primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
