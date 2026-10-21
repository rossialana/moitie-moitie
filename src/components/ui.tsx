import { useEffect, type ReactNode } from 'react';
import type { Member } from '../lib/types.ts';
import { Icon } from './Icon.tsx';

export function Avatar({ member, size = 28, together }: { member?: Member | null; size?: number; together?: boolean }) {
  if (together || !member) {
    return (
      <span className="avatar together" style={{ width: size, height: size, fontSize: size * 0.42 }} title={together ? 'Ensemble' : 'Personne'}>
        {together ? '½' : '?'}
      </span>
    );
  }
  return (
    <span className={`avatar ${member.color}`} style={{ width: size, height: size, fontSize: size * 0.45 }} title={member.name}>
      {member.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function CheckButton({ checked, onClick, label, color }: { checked: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button className={`checkbtn ${checked ? 'on' : ''} ${color ?? ''}`} onClick={onClick} role="checkbox" aria-checked={checked} aria-label={label}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5 9-10" />
      </svg>
    </button>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Message d'erreur lisible pour les erreurs Supabase / PostgREST. */
export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Pas de connexion. Réessaie dans un instant.';
  return msg;
}
