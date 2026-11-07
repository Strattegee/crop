'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  chosenItems, noMatchLine, pickButtonLabel, removeLabel, toggle, visibleValues,
  type PickGroup, type PickItem, type PickNoun,
} from '../../../lib/multi-pick';

/**
 * A compact multi-select drop-down (David, 7 Nov). Built on <details> with real tick boxes inside, so the form posts
 * the same fields (`name` once per ticked value) and still works if JavaScript fails: the drop-down then simply opens
 * and closes with the ticks inside. With JavaScript it adds a search box, chips for what's chosen (each removable),
 * Esc to close (focus back on the button), closing on a click outside, and `children(chosen, remove)` for anything that should
 * appear only for chosen items (the application form's file buttons).
 */
export function MultiPick({ name, label, noun, groups, initial = [], showHeadings = true, chips = true, children }: {
  name: string;
  label: string;
  noun: PickNoun;
  groups: PickGroup[];
  initial?: string[];
  showHeadings?: boolean;
  /** Off when `children` lists the chosen items itself (with their own remove buttons). */
  chips?: boolean;
  children?: (chosen: PickItem[], remove: (value: string) => void) => ReactNode;
}) {
  const id = useId();
  const [chosen, setChosen] = useState<string[]>(initial);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => visibleValues(groups, query), [groups, query]);
  const picked = chosenItems(groups, chosen);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const remove = (value: string) => setChosen(c => c.filter(v => v !== value));
  const close = () => { setOpen(false); summary.current?.focus(); };

  return (
    <div className="multi-pick">
      <span className="multi-pick-label" id={`${id}-label`}>{label}</span>
      <details
        ref={box} open={open}
        onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        onKeyDown={e => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); } }}
      >
        <summary ref={summary} aria-labelledby={`${id}-label ${id}-count`} aria-expanded={open} className="multi-pick-button">
          <span id={`${id}-count`}>{pickButtonLabel(picked.length, noun)}</span>
          <span aria-hidden="true" className="multi-pick-caret">▾</span>
        </summary>
        <div className="multi-pick-panel" role="group" aria-labelledby={`${id}-label`}>
          {total > 6 && (
            <input
              ref={search} type="search" className="multi-pick-search" value={query} placeholder={`Search ${noun.many}`}
              aria-label={`Search ${noun.many}`} aria-controls={`${id}-list`} autoComplete="off"
              onChange={e => setQuery(e.target.value)}
              // Enter in the search box mustn't send the form.
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
            />
          )}
          <div id={`${id}-list`} className="multi-pick-list">
            {groups.map(g => {
              const shown = g.items.filter(i => visible.has(i.value)).length;
              return (
                <div key={g.key} role="group" aria-label={showHeadings ? g.label : undefined} hidden={!shown}>
                  {showHeadings && <p className="multi-pick-group" aria-hidden="true">{g.label}</p>}
                  {g.items.map(i => (
                    // Hidden by a search but still in the form, so a tick made earlier still posts.
                    <label key={i.value} className="multi-pick-option" hidden={!visible.has(i.value)}>
                      <input type="checkbox" name={name} value={i.value} checked={chosen.includes(i.value)}
                        onChange={() => setChosen(c => toggle(c, i.value))} />
                      <span>{i.label}</span>
                    </label>
                  ))}
                </div>
              );
            })}
            {!visible.size && <p className="muted small" role="status" style={{ margin: 4 }}>{noMatchLine(query, noun)}</p>}
          </div>
          <div className="multi-pick-foot">
            <button type="button" className="btn small secondary" onClick={close}>Done</button>
          </div>
        </div>
      </details>
      {chips && picked.length > 0 && (
        <ul className="multi-pick-chips" aria-label={`Chosen ${noun.many}`}>
          {picked.map(i => (
            <li key={i.value} className="multi-pick-chip">
              <span>{i.label}</span>
              <button type="button" aria-label={removeLabel(i.label)} onClick={() => remove(i.value)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {children?.(picked, remove)}
    </div>
  );
}

/** A small file button: "Add photo or file", then the chosen file's name with Remove. The input keeps its `name`. */
export function FileButton({ name, accept, itemName, shortName }: { name: string; accept: string; itemName: string; shortName: (n: string) => string }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);
  return (
    <span className="file-button">
      <label className="btn small secondary">
        <input ref={input} type="file" name={name} accept={accept} className="sr-only" aria-label={`Photo or file for ${itemName}`}
          onChange={e => setFile(e.target.files?.[0]?.name ?? null)} />
        {file ? <span title={file}>{shortName(file)}</span> : 'Add photo or file'}
      </label>
      {file && (
        <button type="button" className="file-button-remove" aria-label={`Remove the file for ${itemName}`}
          onClick={() => { if (input.current) input.current.value = ''; setFile(null); }}>Remove</button>
      )}
    </span>
  );
}
