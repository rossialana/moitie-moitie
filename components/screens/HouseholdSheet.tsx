'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase.ts';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push.ts';
import { useStore } from '../store';
import { Avatar, ErrorText, Sheet, Switch, errorMessage } from '../ui';
import { Icon } from '../Icon';

export default function HouseholdSheet({ onClose, onLeft }: { onClose: () => void; onLeft: () => void }) {
  const { data, me, partner, patchLocal } = useStore();
  const [name, setName] = useState(me.name);
  const [householdName, setHouseholdName] = useState(data.household.name);
  const [copied, setCopied] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    pushState().then(setPush);
  }, []);

  const link = `${location.origin}/?invite=${data.household.invite_code}`;
  const shareText = `Rejoins notre foyer sur Moitié-Moitié. Code : ${data.household.invite_code}`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Moitié-Moitié', text: shareText, url: link });
      } catch { /* partage annulé */ }
      return;
    }
    await navigator.clipboard?.writeText(`${shareText}\n${link}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const [m, h] = await Promise.all([
      supabase.from('members').update({ name: name.trim() }).eq('id', me.id).select().single(),
      supabase.from('households').update({ name: householdName.trim() }).eq('id', data.household.id),
    ]);
    const err = m.error ?? h.error;
    if (err) return setError(errorMessage(err));
    patchLocal('members', m.data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setError(/should be at least/i.test(error.message) ? 'Le mot de passe doit faire au moins 6 caractères.' : errorMessage(error));
    setPassword('');
    setPasswordSaved(true);
    setTimeout(() => setPasswordSaved(false), 3000);
  }

  async function newCode() {
    if (!confirm("Générer un nouveau code ? L'ancien lien ne marchera plus.")) return;
    const { error } = await supabase.rpc('regenerate_invite_code', { p_household: data.household.id });
    if (error) setError(errorMessage(error));
  }

  async function togglePush(on: boolean) {
    setError(null);
    try {
      setPush(on ? await enablePush(data.household.id, me.id) : await disablePush());
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function leave() {
    if (!confirm('Quitter ce foyer ? Tu ne verras plus ses tâches, courses et rappels.')) return;
    const { error } = await supabase.from('members').delete().eq('id', me.id);
    if (error) return setError(errorMessage(error));
    onLeft();
  }

  return (
    <Sheet title="Foyer" onClose={onClose}>
      <div className="space-y-5">
        <section className="card-pad">
          <h3 className="mb-3 text-lg">{data.household.name}</h3>
          <div className="flex flex-wrap gap-5">
            {data.members.map((m) => (
              <span key={m.id} className="flex items-center gap-2 font-semibold"><Avatar member={m} size={38} /> {m.id === me.id ? `${m.name} (toi)` : m.name}</span>
            ))}
            {!partner && <span className="flex items-center gap-2 text-muted"><Avatar size={38} /> En attente…</span>}
          </div>
        </section>

        <section className="card-pad space-y-3">
          <h3 className="text-lg">Inviter ta moitié</h3>
          <p className="text-sm text-muted">Envoie ce lien : la personne se connecte avec son e-mail et arrive directement dans votre foyer.</p>
          <p className="rounded-[10px] border-[3px] border-ink bg-blush py-3 text-center font-display text-4xl tracking-[0.25em]">{data.household.invite_code}</p>
          <button className="btn-primary w-full" onClick={share}><Icon name="share" size={18} /> {copied ? 'Lien copié' : 'Partager le lien'}</button>
          <button className="btn-link mx-auto text-sm" onClick={newCode}>Générer un nouveau code</button>
        </section>

        <section className="card-pad space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg">Notifications</h3>
              <p className="text-sm text-muted">Tâches du jour et rappels, avec le préavis choisi.</p>
            </div>
            {(push === 'on' || push === 'off') && <Switch checked={push === 'on'} onChange={togglePush} label="Notifications" />}
          </div>
          {push === 'denied' && <p className="text-sm">Bloquées sur cet appareil. Autorise-les dans les réglages du navigateur pour ce site.</p>}
          {push === 'unsupported' && <p className="text-sm">Sur iPhone, ajoute d’abord l’app à l’écran d’accueil (Partager, puis « Sur l’écran d’accueil »), puis ouvre-la depuis l’icône.</p>}
          {push === 'not-configured' && <p className="text-sm">Les clés de notification ne sont pas encore configurées sur le serveur (voir README).</p>}
        </section>

        <form className="card-pad space-y-4" onSubmit={saveProfile}>
          <h3 className="text-lg">Profil</h3>
          <label className="block"><span className="label">Ton prénom</span><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block"><span className="label">Nom du foyer</span><input className="input" required value={householdName} onChange={(e) => setHouseholdName(e.target.value)} /></label>
          <button className="btn w-full">{saved ? 'Enregistré' : 'Enregistrer'}</button>
        </form>

        <form className="card-pad space-y-3" onSubmit={savePassword}>
          <h3 className="text-lg">Mot de passe</h3>
          <p className="text-sm text-muted">Facultatif : pour te connecter sur un autre appareil avec ton e-mail et ce mot de passe, sans attendre de code.</p>
          <input className="input" type="password" required minLength={6} autoComplete="new-password" placeholder="6 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Nouveau mot de passe" />
          <button className="btn w-full">{passwordSaved ? 'Mot de passe enregistré' : 'Enregistrer le mot de passe'}</button>
        </form>

        <ErrorText>{error}</ErrorText>
        <button className="btn w-full" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
        <button className="btn-link mx-auto block text-sm" onClick={leave}>Quitter le foyer</button>
      </div>
    </Sheet>
  );
}
