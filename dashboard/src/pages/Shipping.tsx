import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Loader2, AlertCircle, ShoppingCart } from 'lucide-react';
import { watomatisSettingsApi, watomatisApi, watomatisOrdersApi, type VillageItem, type ScalevStore } from '../services/api';
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
  const [scalevEnabled, setScalevEnabled] = useState(false);
  const [scalevApiKey, setScalevApiKey] = useState('');
  const [scalevStoreUniqueId, setScalevStoreUniqueId] = useState('');
  const [scalevWarehouseUniqueId, setScalevWarehouseUniqueId] = useState('');
  const [scalevWarehouseId, setScalevWarehouseId] = useState(0);
  const [scalevCatalog, setScalevCatalog] = useState<
    { ref: string; name: string; price: number; weightGram: number; variantUniqueId: string }[]
  >([]);
  const [stores, setStores] = useState<ScalevStore[]>([]);
  const [scalevError, setScalevError] = useState<string | null>(null);
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
        setScalevEnabled(data.scalev.enabled);
        setScalevApiKey(data.scalev.apiKey);
        setScalevStoreUniqueId(data.scalev.storeUniqueId);
        setScalevWarehouseUniqueId(data.scalev.warehouseUniqueId);
        setScalevWarehouseId(data.scalev.warehouseId);
        setScalevCatalog(data.scalev.catalog ?? []);
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

  const loadStores = async () => {
    setScalevError(null);
    try {
      await handleSave(); // persist the key so the backend can call Scalev
      setStores(await watomatisOrdersApi.stores());
    } catch (err) {
      setScalevError(err instanceof Error ? err.message : t('common.unknownError'));
    }
  };
  const onPickStore = (uniqueId: string) => {
    setScalevStoreUniqueId(uniqueId);
    const store = stores.find(s => s.uniqueId === uniqueId);
    const wh = store?.warehouses[0];
    setScalevWarehouseUniqueId(wh?.uniqueId ?? '');
    setScalevWarehouseId(wh?.id ?? 0);
  };
  const syncCatalog = async () => {
    setScalevError(null);
    try {
      await handleSave();
      await watomatisOrdersApi.syncCatalog();
      const fresh = await watomatisSettingsApi.getSettings();
      setScalevCatalog(fresh.scalev.catalog ?? []);
    } catch (err) {
      setScalevError(err instanceof Error ? err.message : t('common.unknownError'));
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
        scalev: {
          enabled: scalevEnabled,
          apiKey: scalevApiKey.trim(),
          storeUniqueId: scalevStoreUniqueId,
          warehouseUniqueId: scalevWarehouseUniqueId,
          warehouseId: scalevWarehouseId,
          catalog: scalevCatalog,
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
                    className="village-result"
                    onClick={() => {
                      setOriginVillageCode(v.code);
                      setOriginLabel(`${v.name}, ${v.regency}`);
                      setVillageResults([]);
                      setOriginQuery('');
                    }}
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

        <div className="ai-agent-card">
          <h2 className="ai-agent-section-title">
            <ShoppingCart size={18} />
            Scalev (Order otomatis)
          </h2>

          {scalevError && (
            <div className="error-banner" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={18} />
              <span className="error-banner-text">{scalevError}</span>
            </div>
          )}

          <div className="form-group">
            <label className="shipping-inline-label">
              <input
                type="checkbox"
                checked={scalevEnabled}
                onChange={e => setScalevEnabled(e.target.checked)}
                className="shipping-checkbox"
              />
              Aktifkan order ke Scalev
            </label>
          </div>

          <div className="form-group">
            <label>Scalev API key</label>
            <input
              type="password"
              value={scalevApiKey}
              onChange={e => setScalevApiKey(e.target.value)}
              placeholder="Scalev API key"
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label>Store</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select
                value={scalevStoreUniqueId}
                onChange={e => onPickStore(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">Pilih store</option>
                {stores.map(s => (
                  <option key={s.id} value={s.uniqueId}>{s.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void loadStores()}
                disabled={!scalevApiKey.trim()}
                style={{ flexShrink: 0 }}
              >
                Muat store
              </button>
            </div>
          </div>

          <div className="ai-agent-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void syncCatalog()}
              disabled={!scalevApiKey.trim() || !scalevStoreUniqueId}
            >
              Sync katalog ({scalevCatalog.length})
            </button>
            <button className="btn-primary" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
