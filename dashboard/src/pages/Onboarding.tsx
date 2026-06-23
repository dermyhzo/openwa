import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { sessionApi, watomatisApi, type Session, type WatomatisMode } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import './Onboarding.css';

interface StepStatus {
  connected: boolean;
  aiConfigured: boolean;
  activated: boolean;
}

export default function Onboarding() {
  const { t } = useTranslation();
  useDocumentTitle(t('onboarding.title'));

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StepStatus>({ connected: false, aiConfigured: false, activated: false });

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      setLoading(true);
      try {
        const [sessions, profilesRes] = await Promise.all([
          sessionApi.list(),
          watomatisApi.listProfiles(),
        ]);

        const connected = sessions.some(
          (s: Session) => s.status === 'ready',
        );

        const sessionIds: string[] = profilesRes?.sessionIds ?? [];
        const aiConfigured = sessionIds.length > 0;

        let activated = false;
        if (aiConfigured) {
          const profileResults = await Promise.allSettled(
            sessionIds.map((id: string) => watomatisApi.getProfile(id)),
          );
          activated = profileResults.some(result => {
            if (result.status !== 'fulfilled') return false;
            const profile = result.value as { mode?: WatomatisMode } | null;
            return profile?.mode != null && profile.mode !== 'off';
          });
        }

        if (!cancelled) {
          setStatus({ connected, aiConfigured, activated });
        }
      } catch {
        // ignore — steps default to false (to-do)
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchStatus();
    return () => { cancelled = true; };
  }, []);

  const steps = [
    {
      key: 'connect',
      title: t('onboarding.step1Title'),
      desc: t('onboarding.step1Desc'),
      done: status.connected,
      to: '/sessions',
    },
    {
      key: 'configure',
      title: t('onboarding.step2Title'),
      desc: t('onboarding.step2Desc'),
      done: status.aiConfigured,
      to: '/ai-agent',
    },
    {
      key: 'activate',
      title: t('onboarding.step3Title'),
      desc: t('onboarding.step3Desc'),
      done: status.activated,
      to: '/ai-agent',
    },
    {
      key: 'license',
      title: t('onboarding.step4Title'),
      desc: t('onboarding.step4Desc'),
      done: false,
      to: '/license',
    },
  ];

  const doneCount = steps.filter(s => s.done).length;

  return (
    <div className="onboarding-page">
      <PageHeader title={t('onboarding.title')} subtitle={t('onboarding.subtitle')} />

      {loading ? (
        <div className="onboarding-loading">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : (
        <div className="onboarding-content">
          <div className="onboarding-progress-bar-wrap">
            <div className="onboarding-progress-label">
              {t('onboarding.progress', { done: doneCount, total: steps.length })}
            </div>
            <div className="onboarding-progress-track">
              <div
                className="onboarding-progress-fill"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
          </div>

          <div className="onboarding-steps">
            {steps.map((step, idx) => (
              <div key={step.key} className={`onboarding-step ${step.done ? 'onboarding-step--done' : ''}`}>
                <div className="onboarding-step-icon">
                  {step.done
                    ? <CheckCircle2 size={24} className="onboarding-icon--done" />
                    : <Circle size={24} className="onboarding-icon--todo" />}
                </div>
                <div className="onboarding-step-body">
                  <div className="onboarding-step-header">
                    <span className="onboarding-step-number">{idx + 1}.</span>
                    <span className="onboarding-step-title">{step.title}</span>
                    <span className={`onboarding-badge ${step.done ? 'onboarding-badge--done' : 'onboarding-badge--todo'}`}>
                      {step.done ? t('onboarding.statusDone') : t('onboarding.statusTodo')}
                    </span>
                  </div>
                  <p className="onboarding-step-desc">{step.desc}</p>
                  <Link className="onboarding-action-btn" to={step.to}>
                    {step.done ? t('onboarding.actionView') : t('onboarding.actionGo')}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {doneCount === steps.length && (
            <div className="onboarding-complete-banner">
              {t('onboarding.allDone')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
