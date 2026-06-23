import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Upload, Loader2, AlertCircle } from 'lucide-react';
import { watomatisfApi, type LearnResult } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './AiAgent.css';

export default function AiAgent() {
  const { t } = useTranslation();
  useDocumentTitle(t('aiAgent.title'));

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LearnResult | null>(null);

  const handleSubmit = async () => {
    if (!file || !apiKey.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await watomatisfApi.learnFromChat(file, {
        apiKey: apiKey.trim(),
        model: model.trim() || undefined,
        apiBaseUrl: apiBaseUrl.trim() || undefined,
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
      <PageHeader
        title={t('aiAgent.title')}
        subtitle={t('aiAgent.subtitle')}
      />

      <div className="ai-agent-content">
        {/* LLM Config */}
        <div className="ai-agent-card">
          <h2 className="ai-agent-section-title">
            <Bot size={18} />
            {t('aiAgent.llmSection')}
          </h2>

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
              placeholder="gpt-4o-mini"
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
                placeholder="https://api.apimart.ai/v1"
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

          <p className="ai-agent-hint">{t('aiAgent.uploadHint')}</p>

          <label className={`ai-agent-drop${file ? ' has-file' : ''}`}>
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <Upload size={28} />
            <span className="ai-agent-drop-name">
              {file ? file.name : t('aiAgent.chooseFile')}
            </span>
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
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Bot size={16} />
              )}
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
          </>
        )}
      </div>
    </div>
  );
}
