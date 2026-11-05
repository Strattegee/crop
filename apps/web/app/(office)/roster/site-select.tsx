'use client';

type Choice = { id: string; name: string };

/**
 * The site picker on the roster toolbar: changing it shows that site straight away (the form still works without
 * scripts). Projects (David, 5 Nov) are listed in their own group, with their client, so one can be shown on its own;
 * owners and admins also get "+ New project" (`newValue`), which opens the new-project form on the roster.
 */
export function SiteSelect({ name, value, allLabel, sites, projects = [], sitesLabel, projectsLabel, newValue, newLabel }: {
  name: string; value: string; allLabel: string; sites: Choice[]; projects?: Choice[]; sitesLabel?: string; projectsLabel?: string;
  newValue?: string; newLabel?: string;
}) {
  const grouped = projects.length > 0 || Boolean(newValue);
  return (
    <select name={name} defaultValue={value} aria-label="Site" onChange={e => e.currentTarget.form?.requestSubmit()}>
      <option value="">{allLabel}</option>
      {grouped ? (
        <>
          {sites.length > 0 && <optgroup label={sitesLabel ?? 'Sites'}>{sites.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>}
          {(projects.length > 0 || newValue) && (
            <optgroup label={projectsLabel ?? 'Projects'}>
              {projects.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              {newValue && <option value={newValue}>{newLabel ?? '+ New project'}</option>}
            </optgroup>
          )}
        </>
      ) : sites.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
