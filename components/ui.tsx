'use client';

import { useEffect, type ReactNode } from 'react';
import type { Member } from '@/lib/types.ts';
import { Icon } from './Icon';

export function Avatar({ member, size = 30, together }: { member?: Member | null; size?: number; together?: boolean }) {
  const style = { width: size, height: size, fontSize: size * 0.46 };
  if (together) {
    // Deux demi-pastilles côte à côte, couleurs pleines (pas de dégradé).
    return (
      <span className="inline-flex shrink-0 overflow-hidden rounded-full border-2 border-ink" style={{ width: size, height: size }} title="Ensemble">
        <span className="h-full w-1/2 bg-rose" />
        <span className="h-full w-1/2 bg-ink" />
      </span>
    );
  }
  if (!member) {
    return <span className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted font-semibold text-muted" style={style}>?</span>;
  }
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 border-ink font-semibold leading-none person-${member.color}`} style={style} title={member.name}>
      {member.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function CheckButton({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] border-[3px] border-ink ${checked ? 'bg-ink text-cream' : 'bg-cream text-transparent'}`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="sheet-in max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-[20px] border-[3px] border-b-0 border-ink bg-cream px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] sm:rounded-[20px] sm:border-b-[3px]"
      >
        <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between bg-cream px-4 pt-3 pb-3">
          <span aria-hidden className="absolute top-1.5 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-rose" />
          <h2 className="text-2xl">{title}</h2>
          <button className="flex size-10 items-center justify-center rounded-[10px]" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pt-2">
      <div className="min-w-0">
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        <h1 className="text-[40px] leading-none">{title}</h1>
      </div>
      {action}
    </header>
  );
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-action text-cream" onClick={onClick} aria-label={label}>
      <Icon name="plus" size={26} stroke={2.5} />
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[20px] border-[3px] border-dashed border-rose px-4 py-7 text-center text-muted">{children}</div>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-full border-[3px] border-ink px-3.5 py-1.5 text-sm font-semibold ${value === o.value ? 'bg-ink text-cream' : 'bg-cream text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full border-[3px] border-ink ${checked ? 'bg-action' : 'bg-blush'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full border-2 border-ink bg-cream transition-all ${checked ? 'left-[26px]' : 'left-0.5'}`} />
    </button>
  );
}

/** Message d'erreur lisible pour les erreurs Supabase / PostgREST. */
export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Pas de connexion. Réessaie dans un instant.';
  return msg;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="text-sm font-semibold text-action">{children}</p> : null;
}
