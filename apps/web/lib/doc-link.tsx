'use client';

import { useEffect, useRef, useState } from 'react';

/** A document link that shows a small preview when hovered or focused. Images show the picture; PDFs show the first page. */
export function DocLink({ href, filename, contentType }: { href: string; filename: string; contentType?: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false); // keep the preview once fetched, so hovering again doesn't reload it
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const isPdf = contentType === 'application/pdf';
  const isImage = !!contentType?.startsWith('image/');
  const show = () => {
    timer.current = setTimeout(() => {
      // Fixed position so the preview isn't clipped by the card or table around the link.
      const r = anchor.current?.getBoundingClientRect();
      if (r) {
        const left = Math.max(8, Math.min(r.left, window.innerWidth - 300));
        setPos(window.innerHeight - r.bottom > 380 ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
      }
      setOpen(true); setLoaded(true);
    }, 250);
  };
  const hide = () => { if (timer.current) clearTimeout(timer.current); setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [open]);

  return (
    <span ref={anchor} style={{ display: 'inline-block' }} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      <a href={href} target="_blank" rel="noreferrer">{filename}</a>
      {loaded && (isImage || isPdf) && (
        <span
          role="tooltip"
          style={{
            display: open ? 'block' : 'none', position: 'fixed', zIndex: 50, ...pos,
            background: '#fff', border: '1px solid #d0d5dd', borderRadius: 8, boxShadow: '0 6px 20px rgba(16,24,40,.18)', padding: 6,
          }}
        >
          {failed ? (
            <span className="muted" style={{ display: 'block', width: 220, padding: 12, fontSize: 13 }}>No preview for this file type. Click to open it.</span>
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={href} alt={`Preview of ${filename}`} onError={() => setFailed(true)}
              style={{ display: 'block', maxWidth: 280, maxHeight: 280, objectFit: 'contain', borderRadius: 4 }} />
          ) : (
            <iframe src={`${href}#toolbar=0&navpanes=0&view=FitH`} title={`Preview of ${filename}`}
              style={{ display: 'block', width: 260, height: 340, border: 0, borderRadius: 4 }} />
          )}
          <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>Click the name to open it full size</span>
        </span>
      )}
    </span>
  );
}
