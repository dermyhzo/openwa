import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Upload, Loader2, AlertCircle, Zap, Trash2, Lock, CheckCircle2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { watomatisApi, watomatisSettingsApi, sessionApi, type LearnResult, type Session, type WatomatisMode, type WatomatisProduct } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import { useLicense } from '../hooks/useLicense';
import './AiAgent.css';

type Provider = 'apimart' | 'openrouter';

const PROVIDER_BASE: Record<Provider, string> = {
  apimart: 'https://api.apimart.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const PROVIDER_DEFAULT_MODEL: Record<Provider, string> = {
  apimart: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
};

const WANALYSIS_URL =
  'https://chromewebstore.google.com/detail/wanalysis-free-whatsapp-e/ccooahckdbbckgejinhadmbmgappeclm';

// Mirror the backend mask (prefix + last 4) so the UI can preview a key it just saved.
const maskKey = (k: string): string => (k.length <= 7 ? '••••' : `${k.slice(0, 3)}••••••${k.slice(-4)}`);

export default function AiAgent() {
  const { t } = useTranslation();
  useDocumentTitle(t('aiAgent.title'));

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { active: licenseActive, loading: licenseLoading } = useLicense();

  const [provider, setProvider] = useState<Provider>('apimart');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(PROVIDER_DEFAULT_MODEL.apimart);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LearnResult | null>(null);

  // LLM config save (independent of the learn/activate flow)
  const [savingLlm, setSavingLlm] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [savedKeyMask, setSavedKeyMask] = useState('');
  const [editingKey, setEditingKey] = useState(false);

  // Activate card state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activateSessionId, setActivateSessionId] = useState('');
  const [activateMode, setActivateMode] = useState<WatomatisMode>('supervised');
  const [fallbackMessage, setFallbackMessage] = useState('Mohon tunggu ya kak, CS kami akan segera membantu.');
  const [activating, setActivating] = useState(false);
  const [activateSuccess, setActivateSuccess] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

  // Brand knowledge + products
  const [brandKnowledge, setBrandKnowledge] = useState('');
  const [products, setProducts] = useState<WatomatisProduct[]>([]);
  const [importMsg, setImportMsg] = useState<string>('');

  /** Pull the Scalev-synced catalog into the editable product list (merge by name, keep manual rows). */
  const importFromScalev = async () => {
    setImportMsg('');
    try {
      const settings = await watomatisSettingsApi.getSettings();
      const catalog = settings.scalev?.catalog ?? [];
      if (catalog.length === 0) {
        setImportMsg('Katalog Scalev kosong. Sync dulu di menu Shipping.');
        return;
      }
      setProducts(prev => {
        const have = new Set(prev.map(p => p.name.trim().toLowerCase()));
        const added = catalog
          .filter(c => !have.has(c.name.trim().toLowerCase()))
          .map(c => ({ name: c.name, price: c.price ? `Rp${c.price.toLocaleString('id-ID')}` : '', description: c.description ?? '' }));
        setImportMsg(`Import ${added.length} produk dari Scalev (${catalog.length} total).`);
        return [...prev, ...added];
      });
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Gagal import dari Scalev');
    }
  };

  // Guardrails state
  const [typingDelayMs, setTypingDelayMs] = useState('');
  const [dailyCap, setDailyCap] = useState('');
  const [bhStart, setBhStart] = useState('');
  const [bhEnd, setBhEnd] = useState('');

  // Learn from WhatsApp state
  const [learnSessionId, setLearnSessionId] = useState('');
  const [learningFromWa, setLearningFromWa] = useState(false);
  const [learnWaError, setLearnWaError] = useState<string | null>(null);

  // Readiness state
  const [readiness, setReadiness] = useState<{ recordings: number; qna: number; ready: boolean; suggestFullAuto: boolean; reason: string } | null>(null);

  useEffect(() => {
    sessionApi.list().then(list => {
      setSessions(list);
      if (list.length > 0) {
        // Honor a ?session=<id> deep-link (from the Agents page "Configure" action), else default to the first.
        const wanted = searchParams.get('session');
        const initialId = wanted && list.some(s => s.id === wanted) ? wanted : list[0].id;
        setActivateSessionId(initialId);
        setLearnSessionId(initialId);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load an existing saved profile when a session is selected, so the setup is visible and editable.
  useEffect(() => {
    if (!activateSessionId) return;
    setLlmSaved(false);
    setEditingKey(false);
    setApiKey('');
    watomatisApi.getProfile(activateSessionId).then(p => {
      if (!p) { setHasStoredKey(false); setSavedKeyMask(''); return; }
      setHasStoredKey(p.apiKey === '***');
      setSavedKeyMask(p.apiKeyMask || '');
      if (p.provider) setProvider(p.provider as Provider);
      if (p.model) setModel(p.model);
      if (p.apiBaseUrl) setApiBaseUrl(p.apiBaseUrl);
      if (p.mode) setActivateMode(p.mode);
      if (p.fallbackMessage) setFallbackMessage(p.fallbackMessage);
      if (p.brandKnowledge !== undefined) setBrandKnowledge(p.brandKnowledge || '');
      if (p.products) setProducts(p.products);
      if (p.guardrails) {
        setTypingDelayMs(p.guardrails.typingDelayMs ? String(p.guardrails.typingDelayMs) : '');
        setDailyCap(p.guardrails.dailyCap ? String(p.guardrails.dailyCap) : '');
        setBhStart(p.guardrails.businessHours?.start || '');
        setBhEnd(p.guardrails.businessHours?.end || '');
      }
      if (p.voiceCard) setResult({ stats: { turns: 0, me: 0, them: 0 }, voiceCard: p.voiceCard, qna: p.qna || [] });
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateSessionId]);

  useEffect(() => {
    if (result && activateSessionId) {
      void fetchReadiness(activateSessionId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateSessionId, result]);

  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    setModel(PROVIDER_DEFAULT_MODEL[p]);
  };

  // Save just the LLM config (provider/key/model/base URL) to the selected session's profile.
  // The backend merges, so this preserves any learned voice card, brand docs, products, etc.
  const handleSaveLlm = async () => {
    if (!activateSessionId) return;
    setSavingLlm(true);
    setLlmSaved(false);
    setLlmError(null);
    try {
      await watomatisApi.saveProfile({
        sessionId: activateSessionId,
        provider,
        apiKey: apiKey.trim() || '***', // blank/"***" => backend keeps the stored key
        model: model.trim() || PROVIDER_DEFAULT_MODEL[provider],
        apiBaseUrl: apiBaseUrl.trim() || PROVIDER_BASE[provider],
      });
      setLlmSaved(true);
      setHasStoredKey(true);
      if (apiKey.trim()) setSavedKeyMask(maskKey(apiKey.trim()));
      setApiKey('');
      setEditingKey(false);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setSavingLlm(false);
    }
  };

  const handleLearnFromWa = async () => {
    if (!learnSessionId || !apiKey.trim()) return;
    setLearningFromWa(true);
    setLearnWaError(null);
    try {
      const data = await watomatisApi.learnFromSession(learnSessionId, {
        apiKey: apiKey.trim(),
        model: model.trim() || undefined,
        apiBaseUrl: apiBaseUrl.trim() || PROVIDER_BASE[provider],
      });
      setResult(data);
    } catch (err) {
      setLearnWaError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setLearningFromWa(false);
    }
  };

  const fetchReadiness = async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const data = await watomatisApi.getReadiness(sessionId);
      setReadiness(data);
    } catch {
      // non-critical — ignore errors
    }
  };

  const handleActivate = async () => {
    if (!result || !activateSessionId) return;
    setActivating(true);
    setActivateSuccess(null);
    setActivateError(null);
    try {
      await watomatisApi.saveProfile({
        sessionId: activateSessionId,
        provider,
        apiKey: apiKey.trim(),
        model: model.trim(),
        apiBaseUrl: apiBaseUrl.trim() || PROVIDER_BASE[provider],
        mode: activateMode,
        fallbackMessage,
        voiceCard: result.voiceCard,
        qna: result.qna,
        brandKnowledge: brandKnowledge.trim() || undefined,
        products: products.filter(p => p.name.trim()),
        guardrails: {
          typingDelayMs: Number(typingDelayMs) || undefined,
          dailyCap: Number(dailyCap) || undefined,
          businessHours: (bhStart && bhEnd) ? { start: bhStart, end: bhEnd } : undefined,
        },
      });
      setActivateSuccess(t('aiAgent.activateSuccess'));
      void fetchReadiness(activateSessionId);
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setActivating(false);
    }
  };

  const handleSubmit = async () => {
    if (!file || !apiKey.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await watomatisApi.learnFromChat(file, {
        apiKey: apiKey.trim(),
        model: model.trim() || undefined,
        apiBaseUrl: apiBaseUrl.trim() || PROVIDER_BASE[provider],
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-agent-page">
      <PageHeader title={t('aiAgent.title')} subtitle={t('aiAgent.subtitle')} />

      <div className="ai-agent-content">
        {/* License lock banner */}
        {!licenseLoading && !licenseActive && (
          <div className="license-lock-banner">
            <Lock size={18} />
            <span className="license-lock-text">{t('aiAgent.licenseLockMsg')}</span>
            <button
              className="license-lock-btn"
              onClick={() => void navigate('/license')}
            >
              {t('aiAgent.licenseLockAction')}
            </button>
          </div>
        )}

        {/* LLM Config */}
        <div className="ai-agent-card">
          <h2 className="ai-agent-section-title">
            <Bot size={18} />
            {t('aiAgent.llmSection')}
          </h2>

          <div className="form-group">
            <label>{t('aiAgent.providerLabel')}</label>
            <select value={provider} onChange={e => handleProviderChange(e.target.value as Provider)}>
              <option value="apimart">APImart</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>

          <div className="form-group">
            <label>{t('aiAgent.apiKeyLabel')}</label>
            {hasStoredKey && !editingKey ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  readOnly
                  value={savedKeyMask || '••••••••'}
                  style={{ flex: 1, fontFamily: 'monospace', letterSpacing: '0.04em' }}
                />
                <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--primary, #25d366)' }}>
                  <CheckCircle2 size={15} /> {t('aiAgent.keySavedBadge')}
                </span>
                <button
                  type="button"
                  className="ai-agent-advanced-toggle"
                  style={{ flexShrink: 0, margin: 0 }}
                  onClick={() => { setEditingKey(true); setApiKey(''); setLlmSaved(false); }}
                >
                  {t('aiAgent.changeKey')}
                </button>
              </div>
            ) : (
              <>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={t('aiAgent.apiKeyPlaceholder')}
                  autoComplete="new-password"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus={editingKey}
                />
                {hasStoredKey && editingKey && (
                  <button
                    type="button"
                    className="ai-agent-advanced-toggle"
                    style={{ marginTop: '0.5rem' }}
                    onClick={() => { setEditingKey(false); setApiKey(''); }}
                  >
                    {t('aiAgent.cancelChangeKey')}
                  </button>
                )}
              </>
            )}
          </div>

          <div className="form-group">
            <label>{t('aiAgent.modelLabel')}</label>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder={PROVIDER_DEFAULT_MODEL[provider]}
            />
          </div>

          <button
            className="ai-agent-advanced-toggle"
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
          >
            {showAdvanced ? t('aiAgent.hideAdvanced') : t('aiAgent.showAdvanced')}
          </button>

          {showAdvanced && (
            <div className="form-group">
              <label>{t('aiAgent.apiBaseUrlLabel')}</label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={e => setApiBaseUrl(e.target.value)}
                placeholder={PROVIDER_BASE[provider]}
              />
              <small>{t('aiAgent.apiBaseUrlHint')}</small>
            </div>
          )}

          {hasStoredKey && editingKey && !apiKey.trim() && (
            <p className="ai-agent-hint" style={{ margin: '0.25rem 0 0.75rem' }}>{t('aiAgent.keySavedHint')}</p>
          )}

          {llmError && (
            <div className="error-banner" style={{ marginBottom: '0.75rem' }}>
              <AlertCircle size={18} />
              <span className="error-banner-text">{llmError}</span>
            </div>
          )}

          {llmSaved && (
            <div className="ai-agent-activate-success" style={{ marginBottom: '0.75rem' }}>
              {t('aiAgent.llmSaved')}
            </div>
          )}

          <div className="ai-agent-actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => void handleSaveLlm()}
              disabled={savingLlm || !activateSessionId || !licenseActive}
            >
              {savingLlm ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
              {savingLlm ? t('common.saving') : t('aiAgent.saveLlmBtn')}
            </button>
          </div>

          {activateSessionId
            ? (
              <p className="ai-agent-hint" style={{ margin: '0.5rem 0 0' }}>
                {t('aiAgent.savesToSession', { name: sessions.find(s => s.id === activateSessionId)?.name ?? activateSessionId })}
              </p>
            )
            : (
              <p className="ai-agent-hint" style={{ margin: '0.5rem 0 0' }}>{t('aiAgent.llmNoSession')}</p>
            )}
        </div>

        {/* Upload */}
        <div className="ai-agent-card">
          <h2 className="ai-agent-section-title">
            <Upload size={18} />
            {t('aiAgent.uploadSection')}
          </h2>

          <p className="ai-agent-hint">
            {t('aiAgent.uploadHintPre')}
            <a className="ai-agent-link" href={WANALYSIS_URL} target="_blank" rel="noopener noreferrer">WAnalysis</a>
            {t('aiAgent.uploadHintPost')}
          </p>

          <label className={`ai-agent-drop${file ? ' has-file' : ''}`}>
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <Upload size={28} />
            <span className="ai-agent-drop-name">{file ? file.name : t('aiAgent.chooseFile')}</span>
          </label>

          {error && (
            <div className="error-banner" style={{ marginTop: '1rem' }}>
              <AlertCircle size={18} />
              <span className="error-banner-text">{error}</span>
            </div>
          )}

          <div className="ai-agent-actions">
            <button
              className="btn-primary"
              onClick={() => void handleSubmit()}
              disabled={loading || !file || !apiKey.trim() || !licenseActive}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
              {loading ? t('aiAgent.learning') : t('aiAgent.learnBtn')}
            </button>
          </div>

          {/* Learn directly from WhatsApp */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0 0.75rem' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>{t('aiAgent.orDivider')}</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          </div>

          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem' }}>
            {t('aiAgent.learnFromWaHint')}
          </p>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select
              value={learnSessionId}
              onChange={e => setLearnSessionId(e.target.value)}
              style={{ flex: 1, padding: '0.75rem 1rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.9375rem', background: 'var(--bg-light)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
            >
              {sessions.length === 0 && <option value="">{t('aiAgent.activateNoSessions')}</option>}
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.phone ?? t('aiAgent.activateNoPhone')})</option>
              ))}
            </select>
            <button
              className="btn-primary"
              onClick={() => void handleLearnFromWa()}
              disabled={learningFromWa || !apiKey.trim() || !learnSessionId || !licenseActive}
              style={{ flexShrink: 0 }}
            >
              {learningFromWa ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
              {learningFromWa ? t('aiAgent.learning') : t('aiAgent.learnFromWaBtn')}
            </button>
          </div>

          {learnWaError && (
            <div className="error-banner" style={{ marginTop: '0.75rem' }}>
              <AlertCircle size={18} />
              <span className="error-banner-text">{learnWaError}</span>
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <>
            {/* Stats */}
            <div className="ai-agent-card ai-agent-stats-row">
              <span className="ai-agent-stat">
                <span className="ai-agent-stat-num">{result.stats.turns}</span>
                <span className="ai-agent-stat-label">{t('aiAgent.statsTurns')}</span>
              </span>
              <span className="ai-agent-stat-divider" />
              <span className="ai-agent-stat">
                <span className="ai-agent-stat-num">{result.stats.me}</span>
                <span className="ai-agent-stat-label">{t('aiAgent.statsMe')}</span>
              </span>
              <span className="ai-agent-stat-divider" />
              <span className="ai-agent-stat">
                <span className="ai-agent-stat-num">{result.stats.them}</span>
                <span className="ai-agent-stat-label">{t('aiAgent.statsThem')}</span>
              </span>
            </div>

            {/* Voice Card */}
            <div className="ai-agent-card">
              <h2 className="ai-agent-section-title">{t('aiAgent.voiceCardTitle')}</h2>

              <div className="ai-agent-vc-grid">
                <div className="ai-agent-vc-field">
                  <span className="ai-agent-vc-label">{t('aiAgent.vcTone')}</span>
                  <span className="ai-agent-vc-value">{result.voiceCard.tone}</span>
                </div>
                <div className="ai-agent-vc-field">
                  <span className="ai-agent-vc-label">{t('aiAgent.vcFormality')}</span>
                  <span className="ai-agent-vc-value">{result.voiceCard.formality}</span>
                </div>
                <div className="ai-agent-vc-field">
                  <span className="ai-agent-vc-label">{t('aiAgent.vcEmojiUsage')}</span>
                  <span className="ai-agent-vc-value">{result.voiceCard.emojiUsage}</span>
                </div>
                <div className="ai-agent-vc-field">
                  <span className="ai-agent-vc-label">{t('aiAgent.vcAvgChars')}</span>
                  <span className="ai-agent-vc-value">{result.voiceCard.avgReplyChars}</span>
                </div>
              </div>

              {result.voiceCard.quirks.length > 0 && (
                <div className="ai-agent-vc-chips-block">
                  <span className="ai-agent-vc-label">{t('aiAgent.vcQuirks')}</span>
                  <div className="ai-agent-chips">
                    {result.voiceCard.quirks.map((q, i) => (
                      <span key={i} className="ai-agent-chip">{q}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.voiceCard.greetings.length > 0 && (
                <div className="ai-agent-vc-chips-block">
                  <span className="ai-agent-vc-label">{t('aiAgent.vcGreetings')}</span>
                  <div className="ai-agent-chips">
                    {result.voiceCard.greetings.map((g, i) => (
                      <span key={i} className="ai-agent-chip ai-agent-chip--green">{g}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.voiceCard.closings.length > 0 && (
                <div className="ai-agent-vc-chips-block">
                  <span className="ai-agent-vc-label">{t('aiAgent.vcClosings')}</span>
                  <div className="ai-agent-chips">
                    {result.voiceCard.closings.map((c, i) => (
                      <span key={i} className="ai-agent-chip ai-agent-chip--muted">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="ai-agent-vc-summary">
                <span className="ai-agent-vc-label">{t('aiAgent.vcSummary')}</span>
                <p className="ai-agent-vc-summary-text">{result.voiceCard.summary}</p>
              </div>
            </div>

            {/* Q&A Table */}
            {result.qna.length > 0 && (
              <div className="ai-agent-card">
                <h2 className="ai-agent-section-title">{t('aiAgent.qnaTitle')}</h2>
                <div className="ai-agent-table-wrapper">
                  <table className="ai-agent-table">
                    <thead>
                      <tr>
                        <th>{t('aiAgent.qnaQuestion')}</th>
                        <th>{t('aiAgent.qnaAnswer')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.qna.map((row, i) => (
                        <tr key={i}>
                          <td>{row.question}</td>
                          <td>{row.answer}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Activate Card */}
            <div className="ai-agent-card">
              <h2 className="ai-agent-section-title">
                <Zap size={18} />
                {t('aiAgent.activateTitle')}
              </h2>

              <div className="form-group">
                <label>{t('aiAgent.activateSessionLabel')}</label>
                <select
                  value={activateSessionId}
                  onChange={e => setActivateSessionId(e.target.value)}
                >
                  {sessions.length === 0 && (
                    <option value="">{t('aiAgent.activateNoSessions')}</option>
                  )}
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.phone ?? t('aiAgent.activateNoPhone')})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>{t('aiAgent.activateModeLabel')}</label>
                <select
                  value={activateMode}
                  onChange={e => setActivateMode(e.target.value as WatomatisMode)}
                >
                  <option value="off">{t('aiAgent.modeOff')}</option>
                  <option value="supervised">{t('aiAgent.modeSupervised')}</option>
                  <option value="auto">{t('aiAgent.modeAuto')}</option>
                </select>
              </div>

              <div className="form-group">
                <label>{t('aiAgent.fallbackMessageLabel')}</label>
                <input
                  type="text"
                  value={fallbackMessage}
                  onChange={e => setFallbackMessage(e.target.value)}
                  placeholder={t('aiAgent.fallbackMessagePlaceholder')}
                />
              </div>

              {/* Brand knowledge */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', marginTop: '0.25rem' }}>
                <div className="form-group">
                  <label>{t('aiAgent.brandKnowledgeLabel')}</label>
                  <textarea
                    value={brandKnowledge}
                    onChange={e => setBrandKnowledge(e.target.value)}
                    placeholder={t('aiAgent.brandKnowledgePlaceholder')}
                    rows={4}
                    style={{ width: '100%', padding: '0.75rem 1rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.9375rem', background: 'var(--bg-light)', color: 'var(--text-primary)', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  />
                </div>
              </div>

              {/* Products */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  {t('aiAgent.productsLabel')}
                </label>
                {products.map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder={t('aiAgent.productName')}
                      value={p.name}
                      onChange={e => setProducts(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.875rem', background: 'var(--bg-light)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                    <input
                      type="text"
                      placeholder={t('aiAgent.productPrice')}
                      value={p.price ?? ''}
                      onChange={e => setProducts(prev => prev.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                      style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.875rem', background: 'var(--bg-light)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                    <input
                      type="text"
                      placeholder={t('aiAgent.productDescription')}
                      value={p.description ?? ''}
                      onChange={e => setProducts(prev => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                      style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.875rem', background: 'var(--bg-light)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                    <button
                      type="button"
                      onClick={() => setProducts(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.4rem', display: 'flex', alignItems: 'center' }}
                      title={t('aiAgent.removeProduct')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setProducts(prev => [...prev, { name: '', price: '', description: '' }])}
                    style={{ fontSize: '0.875rem', color: 'var(--primary, #25d366)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                  >
                    + {t('aiAgent.addProduct')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void importFromScalev()}
                    style={{ fontSize: '0.875rem', color: 'var(--primary, #25d366)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                  >
                    Import dari Scalev
                  </button>
                </div>
                {importMsg && (
                  <small style={{ display: 'block', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>{importMsg}</small>
                )}
              </div>

              {/* Guardrails */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', marginTop: '0.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  {t('aiAgent.guardrailsSection')}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>{t('aiAgent.typingDelayLabel')}</label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={typingDelayMs}
                      onChange={e => setTypingDelayMs(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>{t('aiAgent.dailyCapLabel')}</label>
                    <input
                      type="number"
                      min="0"
                      value={dailyCap}
                      onChange={e => setDailyCap(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>{t('aiAgent.bhStartLabel')}</label>
                    <input
                      type="time"
                      value={bhStart}
                      onChange={e => setBhStart(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>{t('aiAgent.bhEndLabel')}</label>
                    <input
                      type="time"
                      value={bhEnd}
                      onChange={e => setBhEnd(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Readiness banner */}
              {readiness && readiness.suggestFullAuto && (
                <div style={{ margin: '1.25rem 0 0', padding: '0.875rem 1rem', background: 'rgba(37, 211, 102, 0.08)', border: '1px solid rgba(37, 211, 102, 0.35)', borderRadius: '8px' }}>
                  <p style={{ margin: '0 0 0.375rem', fontWeight: 600, fontSize: '0.875rem', color: '#15803d' }}>
                    {readiness.reason}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {t('aiAgent.readinessSuggestAuto')}
                  </p>
                  <p style={{ margin: '0.375rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {t('aiAgent.readinessCounts', { recordings: readiness.recordings, qna: readiness.qna })}
                  </p>
                </div>
              )}

              {readiness && !readiness.suggestFullAuto && (
                <div style={{ margin: '1.25rem 0 0', padding: '0.625rem 0.875rem', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {t('aiAgent.readinessCounts', { recordings: readiness.recordings, qna: readiness.qna })}
                </div>
              )}

              {activateSuccess && (
                <div className="ai-agent-activate-success" style={{ marginTop: '1rem' }}>
                  {activateSuccess}
                </div>
              )}

              {activateError && (
                <div className="error-banner" style={{ marginBottom: '1rem', marginTop: '1rem' }}>
                  <AlertCircle size={18} />
                  <span className="error-banner-text">{activateError}</span>
                </div>
              )}

              <div className="ai-agent-actions">
                <button
                  className="btn-primary"
                  onClick={() => void handleActivate()}
                  disabled={activating || !activateSessionId || !licenseActive}
                >
                  {activating ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                  {activating ? t('aiAgent.activating') : t('aiAgent.activateBtn')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
