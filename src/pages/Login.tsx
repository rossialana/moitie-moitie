import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { errorMessage } from '../components/ui.tsx';

export default function Login({ invite }: { invite: string | null }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const redirect = location.origin + (invite ? `/?invite=${invite}` : '/');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else setSent(true);
  }

  return (
    <div className="welcome">
      <div className="welcome-logo"><img src="/icon.svg" alt="" width="88" height="88" /></div>
      <h1 className="brand">Moitié-Moitié</h1>
      <p className="lead">Les tâches, les courses et les rappels de la maison, partagés à deux.</p>
      {invite && <p className="pill">Tu as été invité·e à rejoindre un foyer · code {invite}</p>}

      {sent ? (
        <div className="card">
          <h2>Regarde tes e-mails 💌</h2>
          <p>On t'a envoyé un lien de connexion à <strong>{email}</strong>. Ouvre-le sur ce téléphone pour entrer.</p>
          <button className="btn ghost" onClick={() => setSent(false)}>Utiliser une autre adresse</button>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <label className="field">
            <span>Ton adresse e-mail</span>
            <input type="email" required autoComplete="email" inputMode="email" placeholder="prenom@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'Envoi…' : 'Recevoir mon lien de connexion'}</button>
          <p className="muted small">Pas de mot de passe : un lien magique suffit.</p>
        </form>
      )}
    </div>
  );
}
