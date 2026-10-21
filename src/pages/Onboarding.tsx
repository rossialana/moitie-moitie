import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { errorMessage, Segmented } from '../components/ui.tsx';
import type { Color } from '../lib/types.ts';

export default function Onboarding({ invite, onDone }: { invite: string | null; onDone: (householdId: string) => void }) {
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
    <div className="welcome">
      <h1 className="brand">Bienvenue !</h1>
      <p className="lead">Crée votre foyer, ou rejoins celui de ta moitié avec son code.</p>

      <form className="card" onSubmit={submit}>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'create', label: 'Créer un foyer' }, { value: 'join', label: 'Rejoindre' }]} />

        <label className="field">
          <span>Ton prénom</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Camille" autoComplete="given-name" />
        </label>

        {mode === 'create' ? (
          <>
            <label className="field">
              <span>Nom du foyer</span>
              <input required value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
            </label>
            <div className="field">
              <span>Ta couleur</span>
              <div className="color-pick">
                {(['rose', 'bordeaux'] as Color[]).map((c) => (
                  <button type="button" key={c} className={`swatch ${c} ${color === c ? 'on' : ''}`} onClick={() => setColor(c)}>
                    {c === 'rose' ? 'Rose' : 'Bordeaux'}
                  </button>
                ))}
              </div>
              <small className="muted">L'autre personne aura l'autre couleur.</small>
            </div>
          </>
        ) : (
          <label className="field">
            <span>Code d'invitation</span>
            <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC234" className="code-input" maxLength={6} autoCapitalize="characters" />
          </label>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? '…' : mode === 'create' ? 'Créer notre foyer' : 'Rejoindre le foyer'}</button>
      </form>

      <button className="btn link" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
    </div>
  );
}
