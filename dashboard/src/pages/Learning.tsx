import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap, RefreshCw, AlertCircle, Loader2, BookOpen } from 'lucide-react';
import { watomatisApi, sessionApi, type Recording, type Session } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './Learning.css';

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export default function Learning() {
  const { t } = useTranslation();
  useDocumentTitle(t('learning.title'));

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [count, setCount] = useState<number>(0);
  const [items, setItems] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consolidating, setConsolidating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load sessions on mount
  useEffect(() => {
    setSessionsLoading(true);
    sessionApi
      .list()
      .then(data => {
        setSessions(data);
        if (data.length > 0) {
          setSelectedSessionId(data[0].id);
        }
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : t('common.unknownError'));
      })
      .finally(() => {
        setSessionsLoading(false);
      });
  }, [t]);

  const fetchRecordings = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      setSuccessMessage(null);
      try {
        const data = await watomatisApi.getRecordings(sessionId);
        setCount(data.count);
        setItems(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.unknownError'));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // Fetch recordings when selectedSessionId changes
  useEffect(() => {
    if (selectedSessionId) {
      void fetchRecordings(selectedSessionId);
    }
  }, [selectedSessionId, fetchRecordings]);

  const handleSessionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSessionId(e.target.value);
  };

  const handleConsolidate = async () => {
    if (!selectedSessionId || count === 0) return;
    setConsolidating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await watomatisApi.consolidateRecordings(selectedSessionId);
      setSuccessMessage(t('learning.consolidateSuccess', { updated: result.updated }));
      await fetchRecordings(selectedSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setConsolidating(false);
    }
  };

  return (
    <div className="learning-page">
      <PageHeader title={t('learning.title')} subtitle={t('learning.subtitle')} />

      <div className="learning-content">
        {/* Session selector + refresh row */}
        <div className="learning-toolbar">
          <div className="learning-session-selector">
            <label className="learning-select-label" htmlFor="learning-session">
              {t('learning.sessionLabel')}
            </label>
            <select
              id="learning-session"
              className="learning-select"
              value={selectedSessionId}
              onChange={handleSessionChange}
              disabled={sessionsLoading || sessions.length === 0}
            >
              {sessionsLoading && (
                <option value="">{t('common.loading')}</option>
              )}
              {!sessionsLoading && sessions.length === 0 && (
                <option value="">{t('learning.noSessions')}</option>
              )}
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.phone ? ` (${s.phone})` : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            className="learning-refresh-btn"
            onClick={() => void fetchRecordings(selectedSessionId)}
            disabled={loading || !selectedSessionId}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {t('common.refresh')}
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="error-banner learning-error">
            <AlertCircle size={18} />
            <span className="error-banner-text">{error}</span>
          </div>
        )}

        {/* Success banner */}
        {successMessage && (
          <div className="learning-success-banner">
            <GraduationCap size={18} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Stat card */}
        <div className="learning-stat-card">
          <div className="learning-stat-icon">
            <BookOpen size={24} />
          </div>
          <div className="learning-stat-body">
            <span className="learning-stat-value">{loading ? '—' : count}</span>
            <span className="learning-stat-label">{t('learning.statLabel')}</span>
          </div>
          <button
            className="learning-consolidate-btn"
            onClick={() => void handleConsolidate()}
            disabled={consolidating || count === 0 || !selectedSessionId}
          >
            {consolidating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <GraduationCap size={16} />
            )}
            {consolidating ? t('learning.consolidating') : t('learning.consolidateBtn')}
          </button>
        </div>

        {/* Table or empty state */}
        {!loading && items.length === 0 && !error && (
          <div className="learning-empty">
            <GraduationCap size={40} className="learning-empty-icon" />
            <p className="learning-empty-title">{t('learning.emptyTitle')}</p>
            <p className="learning-empty-desc">{t('learning.emptyDesc')}</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="learning-table-wrapper">
            <table className="learning-table">
              <thead>
                <tr>
                  <th>{t('learning.colQuestion')}</th>
                  <th>{t('learning.colAnswer')}</th>
                  <th className="learning-col-time">{t('learning.colTime')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="learning-cell-question">{item.question}</td>
                    <td className="learning-cell-answer">{item.answer}</td>
                    <td className="learning-cell-time">{formatTs(item.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
