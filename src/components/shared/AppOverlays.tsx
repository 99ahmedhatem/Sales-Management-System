import { createContext, lazy, ReactNode, Suspense, useCallback, useContext, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import ErrorBoundary from './ErrorBoundary';

const LeadCard = lazy(() => import('./LeadCard'));
const ProfileView = lazy(() => import('./ProfileView'));

type Role = 'admin' | 'manager' | 'sales' | 'telesales';

interface OverlaysValue {
  /** Opens the client card drawer for this lead. */
  openLead: (leadId: string) => void;
  /** Opens an employee's profile (admin / manager). */
  openProfile: (userId: string) => void;
}

const OverlaysContext = createContext<OverlaysValue>({ openLead: () => {}, openProfile: () => {} });

export const useLeadCard = () => useContext(OverlaysContext).openLead;
export const useProfileViewer = () => useContext(OverlaysContext).openProfile;

export function AppOverlaysProvider({ role, children }: { role: Role; children: ReactNode }) {
  const { t } = useI18n();
  const [leadId, setLeadId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const closeLead = useCallback(() => setLeadId(null), []);

  const value = useMemo<OverlaysValue>(() => ({
    openLead: id => setLeadId(id),
    openProfile: id => setProfileId(id),
  }), []);

  return (
    <OverlaysContext.Provider value={value}>
      {children}
      {leadId && (
        <ErrorBoundary resetKey={leadId}>
          <Suspense fallback={null}>
            <LeadCard leadId={leadId} role={role} onClose={closeLead} />
          </Suspense>
        </ErrorBoundary>
      )}
      {profileId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto">
          <div className="fixed inset-0 bg-black/70 anim-backdrop" onClick={() => setProfileId(null)} />
          <div className="relative my-6 w-full max-w-5xl mx-4 rounded-xl border border-[#262626] bg-[#0c0c0c] anim-modal">
            <button
              onClick={() => setProfileId(null)}
              aria-label={t('Close')}
              className="absolute end-3 top-3 z-10 text-2xl leading-none text-[#6b6b6b] hover:text-white"
            >&times;</button>
            <ErrorBoundary resetKey={profileId}>
              <Suspense fallback={<div className="p-6 text-sm text-[#6b6b6b]">{t('Loading…')}</div>}>
                <ProfileView userId={profileId} />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      )}
    </OverlaysContext.Provider>
  );
}

/** A client's name that opens the client card (stops the click from reaching the row). */
export function ClientLink({ leadId, children, className = '' }: { leadId?: string | null; children: ReactNode; className?: string }) {
  const openLead = useLeadCard();
  if (!leadId) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); openLead(leadId); }}
      className={`text-start hover:text-[#dfff03] hover:underline ${className}`}
    >
      {children}
    </button>
  );
}
