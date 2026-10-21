import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from './lib/supabase.ts';
import { StoreProvider, useStore } from './store.tsx';
import Login from './pages/Login.tsx';
import Onboarding from './pages/Onboarding.tsx';
import Today from './pages/Today.tsx';
import Tasks from './pages/Tasks.tsx';
import Shopping from './pages/Shopping.tsx';
import Reminders from './pages/Reminders.tsx';
import More from './pages/More.tsx';
import { Icon, type IconName } from './components/Icon.tsx';
import { useLocalNotifications } from './lib/notifications.ts';

const INVITE_KEY = 'mm:invite';

/** Le code d'invitation du lien (?invite=XXXX) est gardé le temps de la connexion par e-mail. */
function readInvite(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('invite');
  try {
    if (fromUrl) localStorage.setItem(INVITE_KEY, fromUrl.toUpperCase());
    return fromUrl?.toUpperCase() ?? localStorage.getItem(INVITE_KEY);
  } catch {
    return fromUrl?.toUpperCase() ?? null;
  }
}

export function clearInvite() {
  try {
    localStorage.removeItem(INVITE_KEY);
  } catch { /* stockage indisponible */ }
  if (location.search) history.replaceState(null, '', location.pathname);
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [householdId, setHouseholdId] = useState<string | null | undefined>(undefined);
  const [invite] = useState(readInvite);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setHouseholdId(session === null ? null : undefined);
      return;
    }
    supabase
      .from('members')
      .select('household_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setHouseholdId(data?.household_id ?? null));
  }, [session?.user.id]);

  if (!isConfigured) {
    return (
      <div className="center-screen">
        <h1 className="brand">Moitié-Moitié</h1>
        <p>Il manque la configuration Supabase.</p>
        <p className="muted small">Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir README).</p>
      </div>
    );
  }
  if (session === undefined || (session && householdId === undefined)) {
    return <div className="center-screen"><div className="spinner" /></div>;
  }
  if (!session) return <Login invite={invite} />;
  if (!householdId) return <Onboarding invite={invite} onDone={(id) => { clearInvite(); setHouseholdId(id); }} />;

  return (
    <StoreProvider session={session} householdId={householdId}>
      <Shell onLeft={() => setHouseholdId(null)} />
    </StoreProvider>
  );
}

type Tab = 'today' | 'tasks' | 'shopping' | 'reminders' | 'more';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: "Aujourd'hui", icon: 'home' },
  { id: 'tasks', label: 'Tâches', icon: 'check' },
  { id: 'shopping', label: 'Courses', icon: 'cart' },
  { id: 'reminders', label: 'Rappels', icon: 'bell' },
  { id: 'more', label: 'Plus', icon: 'more' },
];

function Shell({ onLeft }: { onLeft: () => void }) {
  const { data, me, online } = useStore();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (sessionStorage.getItem('mm:tab') as Tab) || 'today';
    } catch {
      return 'today';
    }
  });
  useLocalNotifications();

  useEffect(() => {
    try {
      sessionStorage.setItem('mm:tab', tab);
    } catch { /* stockage indisponible */ }
    window.scrollTo(0, 0);
  }, [tab]);

  const pendingItems = data.items.filter((i) => !i.purchased).length;

  return (
    <div className={`app theme-${me.color}`}>
      {!online && <div className="offline">Hors ligne — les changements seront visibles au retour du réseau</div>}
      <main className="content">
        {tab === 'today' && <Today goTo={setTab} />}
        {tab === 'tasks' && <Tasks />}
        {tab === 'shopping' && <Shopping />}
        {tab === 'reminders' && <Reminders />}
        {tab === 'more' && <More onLeft={onLeft} />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} aria-label={t.label}>
            <span className="tab-icon">
              <Icon name={t.icon} />
              {t.id === 'shopping' && pendingItems > 0 && <span className="badge">{pendingItems}</span>}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
