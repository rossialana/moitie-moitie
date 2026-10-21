'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from '@/lib/supabase.ts';
import { registerServiceWorker } from '@/lib/push.ts';
import type { Color } from '@/lib/types.ts';
import { Loading, StoreProvider, useStore } from './store';
import { ErrorText, Segmented, errorMessage } from './ui';
import { Icon, type IconName } from './Icon';
import Today from './screens/Today';
import Tasks from './screens/Tasks';
import Shopping from './screens/Shopping';
import Week from './screens/Week';
import Reminders from './screens/Reminders';
import HouseholdSheet from './screens/HouseholdSheet';

const INVITE_KEY = 'mm:invite';

/** Le code d'invitation du lien (?invite=XXXX) est gardé le temps de la connexion par e-mail. */
function readInvite(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('invite')?.toUpperCase() ?? null;
  try {
    if (fromUrl) localStorage.setItem(INVITE_KEY, fromUrl);
    return fromUrl ?? localStorage.getItem(INVITE_KEY);
  } catch {
    return fromUrl;
  }
}

function clearInvite() {
  try {
    localStorage.removeItem(INVITE_KEY);
  } catch { /* stockage indisponible */ }
  if (location.search) history.replaceState(null, '', location.pathname);
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [householdId, setHouseholdId] = useState<string | null | undefined>(undefined);
  const [invite, setInvite] = useState<string | null>(null);

  useEffect(() => {
    setInvite(readInvite());
    registerServiceWorker();
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
      <Centered>
        <h1 className="text-5xl text-action">Moitié-Moitié</h1>
        <p>Il manque la configuration Supabase.</p>
        <p className="text-sm text-muted">Renseigne NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir README).</p>
      </Centered>
    );
  }
  if (session === undefined || (session && householdId === undefined)) return <Loading />;
  if (!session) return <Login invite={invite} />;
  if (!householdId) return <Onboarding invite={invite} onDone={(id) => { clearInvite(); setHouseholdId(id); }} />;

  return (
    <StoreProvider session={session} householdId={householdId}>
      <Shell onLeft={() => setHouseholdId(null)} />
    </StoreProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10 text-center">{children}</div>;
}

function Logo() {
  return (
    <div className="flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={84} height={84} />
    </div>
  );
}

// ───────────── Connexion ─────────────

function Login({ invite }: { invite: string | null }) {
  const [mode, setMode] = useState<'code' | 'password'>('code');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ error: unknown }>, onOk?: () => void) {
    setBusy(true);
    setError(null);
    const { error } = await action();
    setBusy(false);
    if (error) setError(errorMessage(error));
    else onOk?.();
  }

  // L'e-mail contient un lien ET un code : le code marche aussi dans l'app installée (iPhone),
  // où le lien s'ouvrirait dans Safari plutôt que dans l'app.
  function sendEmail(e: FormEvent) {
    e.preventDefault();
    const redirect = location.origin + (invite ? `/?invite=${invite}` : '/');
    run(() => supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } }), () => setSent(true));
  }

  function verifyCode(e: FormEvent) {
    e.preventDefault();
    run(() => supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' }));
  }

  function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return { error: error && /invalid login/i.test(error.message) ? new Error('E-mail ou mot de passe incorrect. Pas encore de mot de passe ? Connecte-toi avec un code, puis crée-le dans Foyer.') : error };
    });
  }

  const emailField = (
    <label className="block">
      <span className="label">Ton adresse e-mail</span>
      <input className="input" type="email" required autoComplete="email" inputMode="email" placeholder="prenom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
    </label>
  );

  return (
    <Centered>
      <Logo />
      <h1 className="text-5xl text-action">Moitié-Moitié</h1>
      <p className="text-muted">Les tâches, les courses et les rappels de la maison, partagés à deux.</p>
      {invite && <p className="pill mx-auto bg-blush text-ink">Invitation à rejoindre un foyer · code {invite}</p>}

      {sent ? (
        <form className="card-pad space-y-3 text-left" onSubmit={verifyCode}>
          <h2 className="text-2xl">Regarde tes e-mails</h2>
          <p>On a envoyé un code à <strong>{email}</strong>. Tape-le ici, ou ouvre le lien de l’e-mail sur cet appareil.</p>
          <label className="block">
            <span className="label">Code reçu</span>
            <input
              className="input text-center text-2xl font-bold tracking-[0.4em]"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full" disabled={busy || code.length < 6}>{busy ? 'Vérification…' : 'Entrer'} <Icon name="arrow" size={18} /></button>
          <button type="button" className="btn w-full" onClick={() => { setSent(false); setCode(''); setError(null); }}>Changer d’adresse ou renvoyer</button>
        </form>
      ) : (
        <div className="card-pad space-y-4 text-left">
          <Segmented value={mode} onChange={(m) => { setMode(m); setError(null); }} options={[{ value: 'code', label: 'Code par e-mail' }, { value: 'password', label: 'Mot de passe' }]} />
          {mode === 'code' ? (
            <form className="space-y-3" onSubmit={sendEmail}>
              {emailField}
              <ErrorText>{error}</ErrorText>
              <button className="btn-primary w-full" disabled={busy}>{busy ? 'Envoi…' : 'Recevoir mon code'}</button>
              <p className="text-sm text-muted">Même adresse sur tous tes appareils : tu retrouves le même compte et le même foyer.</p>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={signInWithPassword}>
              {emailField}
              <label className="block">
                <span className="label">Mot de passe</span>
                <input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <ErrorText>{error}</ErrorText>
              <button className="btn-primary w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
              <p className="text-sm text-muted">Le mot de passe se crée une fois connecté·e, dans Foyer (roue crantée).</p>
            </form>
          )}
        </div>
      )}
    </Centered>
  );
}

// ───────────── Création / adhésion au foyer ─────────────

function Onboarding({ invite, onDone }: { invite: string | null; onDone: (householdId: string) => void }) {
  const [mode, setMode] = useState<'create' | 'join'>(invite ? 'join' : 'create');
  const [name, setName] = useState('');
  const [householdName, setHouseholdName] = useState('Notre maison');
  const [color, setColor] = useState<Color>('rose');
  const [code, setCode] = useState(invite ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } =
      mode === 'create'
        ? await supabase.rpc('create_household', { p_name: householdName, p_member_name: name, p_color: color })
        : await supabase.rpc('join_household', { p_code: code, p_member_name: name });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else onDone(data as string);
  }

  return (
    <Centered>
      <h1 className="text-5xl text-action">Bienvenue</h1>
      <p className="text-muted">Crée votre foyer, ou rejoins celui de ta moitié avec son code.</p>

      <form className="card-pad space-y-4 text-left" onSubmit={submit}>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'create', label: 'Créer un foyer' }, { value: 'join', label: 'Rejoindre' }]} />

        <label className="block">
          <span className="label">Ton prénom</span>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Camille" autoComplete="given-name" />
        </label>

        {mode === 'create' ? (
          <>
            <label className="block">
              <span className="label">Nom du foyer</span>
              <input className="input" required value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
            </label>
            <div>
              <span className="label">Ta couleur</span>
              <div className="flex gap-2">
                {(['rose', 'bordeaux'] as Color[]).map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setColor(c)}
                    aria-pressed={color === c}
                    className={`min-h-12 flex-1 rounded-[10px] border-[3px] font-semibold person-${c} ${color === c ? 'border-action outline-[3px] outline-offset-2 outline-action' : 'border-ink'}`}
                  >
                    {c === 'rose' ? 'Rose' : 'Bordeaux'}
                  </button>
                ))}
              </div>
              <small className="mt-1 block text-muted">L'autre personne aura l'autre couleur.</small>
            </div>
          </>
        ) : (
          <label className="block">
            <span className="label">Code d'invitation</span>
            <input className="input text-center text-xl font-bold tracking-[0.3em] uppercase" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC234" maxLength={6} autoCapitalize="characters" />
          </label>
        )}

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? '…' : mode === 'create' ? 'Créer notre foyer' : 'Rejoindre le foyer'} <Icon name="arrow" size={18} />
        </button>
      </form>

      <button className="btn-link mx-auto" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
    </Centered>
  );
}

// ───────────── Application ─────────────

export type Tab = 'today' | 'tasks' | 'shopping' | 'week' | 'reminders';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: "Aujourd'hui", icon: 'home' },
  { id: 'tasks', label: 'Tâches', icon: 'check' },
  { id: 'shopping', label: 'Courses', icon: 'cart' },
  { id: 'week', label: 'Semaine', icon: 'calendar' },
  { id: 'reminders', label: 'Rappels', icon: 'bell' },
];

function Shell({ onLeft }: { onLeft: () => void }) {
  const { data, online } = useStore();
  const [tab, setTab] = useState<Tab>('today');
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('mm:tab') as Tab | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch { /* stockage indisponible */ }
  }, []);

  function go(t: Tab) {
    setTab(t);
    window.scrollTo(0, 0);
    try {
      sessionStorage.setItem('mm:tab', t);
    } catch { /* stockage indisponible */ }
  }

  const pendingItems = data.items.filter((i) => !i.purchased).length;

  return (
    <div className="min-h-dvh">
      {!online && <div className="sticky top-0 z-20 bg-action px-3 py-1.5 text-center text-sm text-cream">Hors ligne : les changements arriveront au retour du réseau</div>}
      <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+104px)]">
        {tab === 'today' && <Today goTo={go} openSettings={() => setSettings(true)} />}
        {tab === 'tasks' && <Tasks />}
        {tab === 'shopping' && <Shopping />}
        {tab === 'week' && <Week />}
        {tab === 'reminders' && <Reminders />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t-[3px] border-ink bg-cream pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-xl">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`flex h-[68px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${tab === t.id ? 'text-action' : 'text-muted'}`}
            >
              <span className={`relative flex h-8 w-12 items-center justify-center rounded-full ${tab === t.id ? 'bg-blush' : ''}`}>
                <Icon name={t.icon} />
                {t.id === 'shopping' && pendingItems > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-action px-1 text-[10px] text-cream">{pendingItems}</span>
                )}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {settings && <HouseholdSheet onClose={() => setSettings(false)} onLeft={onLeft} />}
    </div>
  );
}
