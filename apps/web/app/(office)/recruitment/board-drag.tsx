'use client';

import { useRef, useState, useTransition, type DragEvent, type ReactNode } from 'react';
import { dropMove } from '../../../lib/recruitment';
import { dropOnStage } from './actions';

/**
 * Drag and drop on the recruitment board (David, 31 Oct). The board is server-rendered; this wraps it and listens for
 * drags on its cards (`.rdrag[data-id][data-stage]`, draggable only for applicants) and drops on its columns
 * (`.rcol[data-stage]`). Only moves between Applied, Screening, Interview and Offer are made this way; starting
 * onboarding still needs its checklist, so the buttons on each card stay for that and for keyboard use.
 */
export function BoardDrag({ children }: { children: ReactNode }) {
  const from = useRef<{ id: string; stage: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const column = (e: DragEvent) => (e.target as HTMLElement).closest<HTMLElement>('.rcol[data-stage]');
  const onDragStart = (e: DragEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.rdrag[data-id][data-stage]');
    if (!card || card.getAttribute('draggable') !== 'true') return;
    from.current = { id: card.dataset.id!, stage: card.dataset.stage! };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id!);
  };
  const onDragOver = (e: DragEvent) => {
    const col = column(e);
    const move = from.current && col ? dropMove(from.current.stage, col.dataset.stage!) : null;
    if (!move) { if (over) setOver(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (over !== col!.dataset.stage) setOver(col!.dataset.stage!);
  };
  const onDrop = (e: DragEvent) => {
    const col = column(e);
    const f = from.current;
    from.current = null;
    setOver(null);
    const move = f && col ? dropMove(f.stage, col.dataset.stage!) : null;
    if (!f || !move) return;
    e.preventDefault();
    start(() => dropOnStage(f.id, move.stage, move.label));
  };
  const onDragEnd = () => { from.current = null; setOver(null); };

  return (
    <div className={`rboard${pending ? ' moving' : ''}`} data-over={over ?? undefined}
      onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} aria-busy={pending || undefined}>
      {children}
    </div>
  );
}
