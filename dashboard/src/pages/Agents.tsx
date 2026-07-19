import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Plus, MoreVertical, Loader2, X, RefreshCw, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { sessionApi, watomatisApi, type Session, type WatomatisMode } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import { useLicense } from '../hooks/useLicense';
import { useToast } from '../components/Toast';
import './Agents.css';

interface AgentProfile {
  mode?: WatomatisMode;
  products?: { name: string }[];
  voiceCard?: unknown;
}

interface AgentData {
  session: Session;
  profile: AgentProfile | null;
  profileLoaded: boolean;
}

type ConnectionGroup = 'ready' | 'qr' | 'disconnected';

function getConnectionGroup(status: Session['status']): ConnectionGroup {
  if (status === 'ready') return 'ready';
  if (status === 'qr_ready' || status === 'connecting' || status === 'initializing') return 'qr';
  return 'disconnected';
}

function ConnectionBadge({ status }: { status: Session['status'] }) {
  const { t } = useTranslation();
  const group = getConnectionGroup(status);
  const label =
    group === 'ready'
      ? t('agents.statusConnected')
      : group === 'qr'
        ? t('agents.statusNeedsQr')
        : t('agents.statusDisconnected');
  return <span className={`agents-conn-badge agents-conn-badge--${group}`}>{label}</span>;
}

function ModeBadge({ mode }: { mode?: WatomatisMode }) {
  const { t } = useTranslation();
  if (!mode || mode === 'off') return <span className="agents-mode-badge agents-mode-badge--off">{t('agents.modeOff')}</span>;
  if (mode === 'supervised') return <span className="agents-mode-badge agents-mode-badge--supervised">{t('agents.modeSupervised')}</span>;
  return <span className="agents-mode-badge agents-mode-badge--auto">{t('agents.modeAuto')}</span>;
}

// QR connect modal: start session, poll for QR, poll until ready
function QrModal({
  session,
  onReady,
  onClose,
}: {
  session: Session;
  onReady: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [qrCode, setQrCode] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const qr = await sessionApi.getQR(session.id);
      if (qr.status === 'ready') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        onReady();
        return;
      }
      if (qr.qrCode) setQrCode(qr.qrCode);
    } catch {
      // Keep polling; check if session flipped to ready
      try {
        const s = await sessionApi.get(session.id);
        if (s.status === 'ready') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onReady();
        }
      } catch {
        // ignore
      }
    }
  }, [session.id, onReady]);

  useEffect(() => {
    // Start the session then begin polling
    sessionApi.start(session.id).catch(() => {});
    poll();
    intervalRef.current = setInterval(poll, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="agents-modal-overlay" onClick={onClose}>
      <div className="agents-modal" onClick={e => e.stopPropagation()}>
        <div className="agents-modal-header">
          <h2>{t('agents.scanQrTitle')}</h2>
          <span className="agents-modal-session-name">{session.name}</span>
          <button className="agents-modal-close" onClick={onClose} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </div>
        <div className="agents-modal-body agents-modal-body--center">
          {qrCode ? (
            <>
              <img src={qrCode} alt="QR code" className="agents-qr-img" />
              <p className="agents-qr-hint">
                <RefreshCw size={13} className="animate-spin" /> {t('agents.qrAutoRefresh')}
              </p>
            </>
          ) : (
            <div className="agents-qr-loading">
              <Loader2 size={40} className="animate-spin" />
              <p>{t('agents.qrGenerating')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Add agent modal: name input then QR step
function AddAgentModal({
  sessions,
  onCreated,
  onClose,
  licenseActive,
}: {
  sessions: Session[];
  onCreated: (session: Session) => void;
  onClose: () => void;
  licenseActive: boolean;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'name' | 'qr'>('name');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newSession, setNewSession] = useState<Session | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const s = await sessionApi.create(name.trim());
      setNewSession(s);
      setStep('qr');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setCreating(false);
    }
  };

  const isNameTaken = sessions.some(s => s.name === name.trim());
  const isNameValid = /^[a-z0-9-]+$/.test(name);
  const canCreate = name.trim() && isNameValid && name.length <= 50 && !isNameTaken;

  if (step === 'qr' && newSession) {
    return (
      <QrModal
        session={newSession}
        onReady={() => onCreated(newSession)}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="agents-modal-overlay" onClick={onClose}>
      <div className="agents-modal" onClick={e => e.stopPropagation()}>
        <div className="agents-modal-header">
          <h2>{t('agents.createAgent')}</h2>
          <button className="agents-modal-close" onClick={onClose} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </div>
        <div className="agents-modal-body">
          <label className="agents-field-label">{t('agents.agentNameLabel')}</label>
          <input
            type="text"
            className="agents-field-input"
            placeholder={t('agents.agentNamePlaceholder')}
            value={name}
            onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            onKeyDown={e => e.key === 'Enter' && canCreate && handleCreate()}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          {name && !isNameValid && (
            <p className="agents-field-error">{t('sessions.create.invalidChars')}</p>
          )}
          {name && isNameTaken && (
            <p className="agents-field-error">{t('sessions.create.duplicate')}</p>
          )}
          {createError && <p className="agents-field-error">{createError}</p>}
        </div>
        <div className="agents-modal-footer">
          <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={creating || !canCreate || !licenseActive}
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : null}
            {t('common.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Agents() {
  const { t } = useTranslation();
  useDocumentTitle(t('agents.title'));
  const navigate = useNavigate();
  const toast = useToast();
  const { active: licenseActive, loading: licenseLoading } = useLicense();

  const [agents, setAgents] = useState<AgentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [qrSession, setQrSession] = useState<Session | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sessions = await sessionApi.list();
      // Kick off profile loads concurrently; fill in as they resolve
      const initial: AgentData[] = sessions.map(s => ({ session: s, profile: null, profileLoaded: false }));
      setAgents(initial);
      setLoading(false);

      // Load profiles in background and update cards as they arrive
      sessions.forEach(s => {
        watomatisApi.getProfile(s.id)
          .then(profile => {
            setAgents(prev =>
              prev.map(a => a.session.id === s.id ? { ...a, profile: profile as AgentProfile | null, profileLoaded: true } : a),
            );
          })
          .catch(() => {
            setAgents(prev =>
              prev.map(a => a.session.id === s.id ? { ...a, profile: null, profileLoaded: true } : a),
            );
          });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // Close kebab on outside click
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenu]);

  const handleDelete = async (id: string) => {
    try {
      await sessionApi.delete(id);
      setAgents(prev => prev.filter(a => a.session.id !== id));
      toast.success(t('sessions.delete.successTitle'), t('sessions.delete.successDescGeneric'));
    } catch (err) {
      toast.error(t('sessions.delete.errorTitle'), err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleQrReady = async (session: Session) => {
    setQrSession(null);
    await loadAgents();
    navigate(`/ai-agent?session=${session.id}`);
  };

  const handleAddCreated = async (session: Session) => {
    setShowAdd(false);
    await loadAgents();
    navigate(`/ai-agent?session=${session.id}`);
  };

  if (loading) {
    return (
      <div className="agents-page">
        <div className="agents-loading">
          <Loader2 size={32} className="animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="agents-page">
      <PageHeader
        title={t('agents.title')}
        subtitle={t('agents.subtitle')}
        actions={
          <button
            className="btn-primary"
            onClick={() => setShowAdd(true)}
            disabled={!licenseActive && !licenseLoading}
          >
            <Plus size={18} />
            {t('agents.addAgent')}
          </button>
        }
      />

      {!licenseLoading && !licenseActive && (
        <div className="license-lock-banner">
          <Lock size={18} />
          <span className="license-lock-text">{t('aiAgent.licenseLockMsg')}</span>
          <button className="license-lock-btn" onClick={() => navigate('/license')}>
            {t('aiAgent.licenseLockAction')}
          </button>
        </div>
      )}

      {error && (
        <div className="error-banner" style={{ marginBottom: '1rem' }}>
          <span className="error-banner-text">{error}</span>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="agents-empty">
          <Bot size={48} className="agents-empty-icon" />
          <h3 className="agents-empty-title">{t('agents.emptyTitle')}</h3>
          <p className="agents-empty-body">{t('agents.emptyBody')}</p>
          <button
            className="btn-primary"
            onClick={() => setShowAdd(true)}
            disabled={!licenseActive && !licenseLoading}
          >
            <Plus size={18} />
            {t('agents.addAgent')}
          </button>
        </div>
      ) : (
        <div className="agents-grid">
          {agents.map(({ session, profile, profileLoaded }) => {
            const group = getConnectionGroup(session.status);
            const productCount = profile?.products?.length ?? 0;
            const hasVoice = !!(profile as { voiceCard?: unknown } | null)?.voiceCard;
            const isConnected = group === 'ready';
            const initials = session.name.slice(0, 2).toUpperCase();

            return (
              <div key={session.id} className="agents-card">
                <div className="agents-card-top">
                  <div className="agents-avatar">{initials}</div>
                  <div className="agents-card-name-block">
                    <span className="agents-card-name">{session.name}</span>
                    <span className="agents-card-phone">
                      {session.phone ?? t('agents.notConnectedYet')}
                    </span>
                  </div>
                  <div className="agents-card-kebab-wrap" onClick={e => e.stopPropagation()}>
                    <button
                      className="agents-kebab-btn"
                      onClick={() => setOpenMenu(m => (m === session.id ? null : session.id))}
                      aria-label="More options"
                    >
                      <MoreVertical size={18} />
                    </button>
                    {openMenu === session.id && (
                      <div className="agents-kebab-menu">
                        <button
                          className="agents-kebab-item"
                          onClick={() => { setOpenMenu(null); navigate(`/ai-agent?session=${session.id}`); }}
                        >
                          {t('agents.configure')}
                        </button>
                        <button
                          className="agents-kebab-item agents-kebab-item--danger"
                          onClick={() => { setOpenMenu(null); setDeleteConfirmId(session.id); }}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="agents-card-badges">
                  <ConnectionBadge status={session.status} />
                  {profileLoaded
                    ? <ModeBadge mode={profile?.mode} />
                    : <span className="agents-mode-badge agents-mode-badge--off">...</span>}
                </div>

                {profileLoaded && (
                  <div className="agents-card-stat">
                    {profile
                      ? `${productCount} ${productCount === 1 ? t('agents.product') : t('agents.products')}${hasVoice ? ' · ' + t('agents.voiceLearned') : ''}`
                      : t('agents.noConfigYet')}
                  </div>
                )}

                <div className="agents-card-action">
                  {isConnected ? (
                    <button
                      className="btn-primary agents-card-btn"
                      disabled={!licenseActive}
                      onClick={() => navigate(`/ai-agent?session=${session.id}`)}
                    >
                      {t('agents.configure')}
                    </button>
                  ) : (
                    <button
                      className="btn-primary agents-card-btn"
                      disabled={!licenseActive}
                      onClick={() => setQrSession(session)}
                    >
                      {t('agents.connect')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddAgentModal
          sessions={agents.map(a => a.session)}
          onCreated={handleAddCreated}
          onClose={() => setShowAdd(false)}
          licenseActive={licenseActive}
        />
      )}

      {qrSession && (
        <QrModal
          session={qrSession}
          onReady={() => handleQrReady(qrSession)}
          onClose={() => setQrSession(null)}
        />
      )}

      {deleteConfirmId && (
        <div className="agents-modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="agents-modal agents-modal--confirm" onClick={e => e.stopPropagation()}>
            <div className="agents-modal-header">
              <h2>{t('agents.deleteTitle')}</h2>
              <button className="agents-modal-close" onClick={() => setDeleteConfirmId(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="agents-modal-body">
              <p>{t('agents.deleteConfirm', { name: agents.find(a => a.session.id === deleteConfirmId)?.session.name ?? '' })}</p>
            </div>
            <div className="agents-modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteConfirmId(null)}>{t('common.cancel')}</button>
              <button className="btn-danger" onClick={() => handleDelete(deleteConfirmId)}>{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
