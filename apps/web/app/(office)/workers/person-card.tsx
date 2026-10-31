import Link from 'next/link';
import {
  avatarColour, badgeList, displayName, EMPLOYMENT_LETTER, expiryLine, hoursLine, initials, LIGHT, STATUS_WORD, type CardPerson,
} from '../../../lib/person-card';
import { EMPLOYMENT_LABEL } from './[id]/employment-card';

/**
 * The employee card (David, 31 Oct): one compact summary of a person, the same everywhere it appears.
 * `size="full"` is the header of the person's page (contact details and every badge); `compact` is for lists.
 */
export function PersonCard({ p, today, size = 'compact', link = true }: { p: CardPerson; today: string; size?: 'compact' | 'full'; link?: boolean }) {
  const c = p.card;
  const light = LIGHT[p.compliance] ?? LIGHT.non_compliant;
  const expiry = expiryLine(c?.nextExpiry ?? null, today);
  const badges = badgeList(c?.held ?? [], size === 'full' ? 50 : 4);
  const name = displayName(p);
  const letter = c?.employmentType ? EMPLOYMENT_LETTER[c.employmentType] : null;
  return (
    <div className={`pcard ${size}`}>
      <div className="pcard-top">
        <span className="pcard-avatar" style={{ background: avatarColour(p.id) }} aria-hidden="true">{initials(p)}</span>
        <div className="pcard-who">
          <div className="pcard-name">
            {link ? <Link href={`/workers/${p.id}`}>{name}</Link> : name}
            {p.preferredName && size === 'full' && <span className="muted"> ({p.firstName})</span>}
            {p.gender && <b className={`mk mk-g soft ${p.gender.toLowerCase()}`} title={p.gender === 'F' ? 'Female' : 'Male'}>{p.gender}</b>}
            {STATUS_WORD[p.status] && <span className="badge neutral">{STATUS_WORD[p.status]}</span>}
          </div>
          <div className="pcard-roles">{p.roles.join(', ') || 'No roles yet'}</div>
        </div>
        <span className={`pcard-light ${light.cls}`} title={light.label}><i aria-hidden="true" />{light.label}</span>
      </div>

      <div className="pcard-facts">
        <span>
          {letter && <b className="pcard-emp" title={EMPLOYMENT_LABEL[c!.employmentType!]}>{letter}</b>}
          {c?.employmentType ? EMPLOYMENT_LABEL[c.employmentType] : <span className="muted">Employment not set</span>}
        </span>
        {c && <span>{hoursLine(c)}</span>}
        {c?.nextShift ? <span>Next: {c.nextShift.label}</span> : <span className="muted">No shifts coming up</span>}
        {expiry && <span className={expiry.soon ? 'pcard-soon' : ''}>{expiry.text}</span>}
        {!!c?.toCheck && <span className="pcard-check">{c.toCheck} to check</span>}
      </div>

      {(badges.shown.length > 0 || size === 'full') && (
        <div className="pcard-badges">
          {badges.shown.map(b => <span key={b} className="pcard-badge">{b}</span>)}
          {badges.more > 0 && <span className="pcard-badge more">+{badges.more} more</span>}
          {badges.shown.length === 0 && <span className="muted small">Nothing verified yet</span>}
        </div>
      )}

      {size === 'full' && (p.email || p.phone) && (
        <div className="pcard-contact">
          {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
          {p.phone && <a href={`tel:${p.phone.replace(/\s+/g, '')}`}>{p.phone}</a>}
        </div>
      )}
    </div>
  );
}
