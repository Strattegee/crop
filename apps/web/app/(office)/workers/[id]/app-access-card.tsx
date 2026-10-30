import { giveAppAccess } from './app-access-actions';

export type AppAccess = { state: 'none' | 'invited' | 'active'; email: string | null; invitedAt: string | null; refusal: string | null };

/** The worker app (backlog item 9): whether this person can sign in to see their shifts and answer offers. */
export function AppAccessCard({ workerId, a, first, canGive, timeZone }: {
  workerId: string; a: AppAccess; first: string; canGive: boolean; timeZone: string;
}) {
  if (a.state === 'none' && !canGive) return null;
  const day = (s: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(s));
  return (
    <div className="card">
      <h2>Worker app</h2>
      {a.state === 'active' && <p style={{ margin: 0 }}>{first} can sign in to the app with {a.email ?? 'their email'} to see their shifts and answer offers.</p>}
      {a.state === 'invited' && (
        <p style={{ margin: 0 }}>
          Invited{a.invitedAt && ` on ${day(a.invitedAt)}`}. {first} gets in the first time they sign in with {a.email} (the email must be verified when they sign in).
        </p>
      )}
      {a.state === 'none' && (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            With the app, {first} sees their shifts in published weeks and can accept or decline offers. They sign in with their email address.
          </p>
          {a.refusal ? <p className="muted" style={{ margin: 0 }}>{a.refusal}.</p> : (
            <form action={giveAppAccess.bind(null, workerId)}>
              <button type="submit" className="btn">Give app access ({a.email})</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
