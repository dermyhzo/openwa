import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox, RefreshCw, Send, X, AlertCircle, Loader2 } from 'lucide-react';
import { watomatisApi, type Draft } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './Drafts.css';

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Drafts() {
  const { t } = useTranslation();
  useDocumentTitle(t('drafts.title'));

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await watomatisApi.listDrafts();
      setDrafts(data);
      // Pre-fill edit buffers from fetched replies, preserving any in-progress edits
      setEditedTexts(prev => {
        const next = { ...prev };
        data.forEach(d => {
          if (!(d.id in next)) next[d.id] = d.reply;
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts]);

  const handleApprove = async (draft: Draft) => {
    setActionLoading(prev => ({ ...prev, [draft.id]: true }));
    try {
      await watomatisApi.approveDraft(draft.id, editedTexts[draft.id]);
      await fetchDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setActionLoading(prev => ({ ...prev, [draft.id]: false }));
    }
  };

  const handleDismiss = async (draft: Draft) => {
    setActionLoading(prev => ({ ...prev, [draft.id]: true }));
    try {
      await watomatisApi.dismissDraft(draft.id);
      setDrafts(prev => prev.filter(d => d.id !== draft.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setActionLoading(prev => ({ ...prev, [draft.id]: false }));
    }
  };

  return (
    <div className="drafts-page">
      <PageHeader title={t('drafts.title')} subtitle={t('drafts.subtitle')} />

      <div className="drafts-content">
        <div className="drafts-toolbar">
          <button
            className="drafts-refresh-btn"
            onClick={() => void fetchDrafts()}
            disabled={loading}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {t('common.refresh')}
          </button>
        </div>

        {error && (
          <div className="error-banner drafts-error">
            <AlertCircle size={18} />
            <span className="error-banner-text">{error}</span>
          </div>
        )}

        {!loading && drafts.length === 0 && !error && (
          <div className="drafts-empty">
            <Inbox size={40} className="drafts-empty-icon" />
            <p className="drafts-empty-title">{t('drafts.emptyTitle')}</p>
            <p className="drafts-empty-desc">{t('drafts.emptyDesc')}</p>
          </div>
        )}

        {drafts.map(draft => (
          <div key={draft.id} className="draft-card">
            <div className="draft-meta">
              <span className="draft-chat-id">{draft.chatId}</span>
              <span className="draft-time">{relativeTime(draft.createdAt)}</span>
            </div>

            <div className="draft-incoming">
              <span className="draft-label">{t('drafts.customerMessage')}</span>
              <p className="draft-incoming-text">{draft.incoming}</p>
            </div>

            <div className="draft-reply-section">
              <span className="draft-label">{t('drafts.suggestedReply')}</span>
              <textarea
                className="draft-reply-textarea"
                value={editedTexts[draft.id] ?? draft.reply}
                onChange={e =>
                  setEditedTexts(prev => ({ ...prev, [draft.id]: e.target.value }))
                }
                rows={3}
              />
            </div>

            <div className="draft-actions">
              <button
                className="draft-btn draft-btn--send"
                onClick={() => void handleApprove(draft)}
                disabled={actionLoading[draft.id]}
              >
                {actionLoading[draft.id]
                  ? <Loader2 size={15} className="animate-spin" />
                  : <Send size={15} />}
                {t('drafts.sendBtn')}
              </button>
              <button
                className="draft-btn draft-btn--dismiss"
                onClick={() => void handleDismiss(draft)}
                disabled={actionLoading[draft.id]}
              >
                <X size={15} />
                {t('drafts.dismissBtn')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
