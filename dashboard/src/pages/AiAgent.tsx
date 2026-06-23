import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Upload, Loader2, AlertCircle, Zap } from 'lucide-react';
import { watomatisApi, sessionApi, type LearnResult, type Session, type WatomatisMode } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
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

export default function AiAgent() {
  const { t } = useTranslation();
  useDocumentTitle(t('aiAgent.title'));

  const [provider, setProvider] = useState<Provider>('apimart');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(PROVIDER_DEFAULT_MODEL.apimart);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LearnResult | null>(null);

  // Activate card state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activateSessionId, setActivateSessionId] = useState('');
  const [activateMode, setActivateMode] = useState<WatomatisMode>('supervised');
  const [fallbackMessage, setFallbackMessage] = useState('Mohon tunggu ya kak, CS kami akan segera membantu.');
  const [activating, setActivating] = useState(false);
  const [activateSuccess, setActivateSuccess] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

  useEffect(() => {
    sessionApi.list().then(list => {
      setSessions(list);
      if (list.length > 0) setActivateSessionId(list[0].id);
    }).catch(() => {});
  }, []);

  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    setModel(PROVIDER_DEFAULT_MODEL[p]);
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
      });
      setActivateSuccess(t('aiAgent.activateSuccess'));
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
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={t('aiAgent.apiKeyPlaceholder')}
              autoComplete="new-password"
            />
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
        </div>

        {/* Upload */}
        <div className="ai-agent-card">
          <h2 className="ai-agent-section-title">
            <Upload size={18} />
            {t('aiAgent.uploadSection')}
          </h2>

          <p className="ai-agent-hint">
            {t('aiAgent.uploadHint')}{' '}
            <a className="ai-agent-link" href={WANALYSIS_URL} target="_blank" rel="noopener noreferrer">
              {t('aiAgent.getWanalysis')}
            </a>
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
              disabled={loading || !file || !apiKey.trim()}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
              {loading ? t('aiAgent.learning') : t('aiAgent.learnBtn')}
            </button>
          </div>
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

              {activateSuccess && (
                <div className="ai-agent-activate-success">
                  {activateSuccess}
                </div>
              )}

              {activateError && (
                <div className="error-banner" style={{ marginBottom: '1rem' }}>
                  <AlertCircle size={18} />
                  <span className="error-banner-text">{activateError}</span>
                </div>
              )}

              <div className="ai-agent-actions">
                <button
                  className="btn-primary"
                  onClick={() => void handleActivate()}
                  disabled={activating || !activateSessionId}
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
