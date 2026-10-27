'use server';

import { api } from '../../../lib/api';
import { revalidatePath } from 'next/cache';
import { attempt } from '../../../lib/actions';
import { completeDemoCredentials } from '../demo-tools';

type Added = { roles: number; credentials: number; requirements: number; shiftCodes: number; equipmentTypes: number; items: number };
type Pack = {
  id: string; name: string;
  credentials: { name: string; number: boolean; expiry: boolean }[];
  roles: { name: string; must?: string[]; should?: string[] }[];
  equipmentTypes: { name: string }[];
};

export async function applyPack(id: string) {
  let added: Added | undefined;
  await attempt('/settings', async () => {
    added = (await api<{ added: Added }>(`/industry-packs/${id}/apply`, { method: 'POST' })).added;
    revalidatePath('/', 'layout');
  }, 'Template applied. Adjust roles, rules, shift types, shift duties, equipment and items to suit the business.');
  void added;
}

// Invented names only.
const FIRST = ['Ava', 'Noah', 'Mila', 'Leo', 'Zara', 'Kai', 'Ruby', 'Eli', 'Tess', 'Jai', 'Nina', 'Ari', 'Lena', 'Max', 'Isla', 'Theo', 'Maya', 'Remy', 'Ivy', 'Sol', 'Cleo', 'Rhys', 'Esme', 'Taj', 'Lola', 'Finn', 'Mira', 'Otto', 'Skye', 'Beau'];
const LAST = ['Archer', 'Bishop', 'Carver', 'Dalton', 'Ellery', 'Fairbank', 'Garrick', 'Hollis', 'Ingram', 'Jessop', 'Kendall', 'Lockett', 'Marlow', 'Norwood', 'Oakley', 'Pemberton', 'Quill', 'Radley', 'Sutton', 'Thorne', 'Upton', 'Vance', 'Wilder', 'Yardley'];
const TYPES = ['full_time', 'casual', 'part_time', 'bank'] as const;
const HOURS: Record<string, number | undefined> = { full_time: 38, part_time: 24 };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Staging only (DEMO_TOOLS=on): two invented, fully compliant people per role in a template, plus one of each equipment type. */
export async function addDemoStaff(id: string) {
  if (process.env.DEMO_TOOLS !== 'on') return;
  await attempt('/settings', async () => {
    const pack = await api<Pack>(`/industry-packs/${id}`);
    const types = await api<{ id: string; name: string }[]>('/credential-types');
    const typeId = new Map(types.map(t => [t.name.toLowerCase(), t.id]));
    const libs = new Map(pack.credentials.map(c => [c.name, c]));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
    const seed = [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    let n = 0;
    const post = <T = { id: string }>(p: string, body: unknown) => api<T>(p, { method: 'POST', body });
    const people: { role: string; i: number }[] = pack.roles.flatMap(r => [{ role: r.name, i: 0 }, { role: r.name, i: 1 }]);
    const created: string[] = [];
    const addOne = async ({ role, i }: { role: string; i: number }) => {
      const k = seed + n++;
      const first = FIRST[k % FIRST.length], last = LAST[(k * 7 + i) % LAST.length];
      const type = TYPES[(k + i) % TYPES.length];
      const w = (await post('/workers', { firstName: first, lastName: last, roles: [role], email: `${first}.${last}.${k}@example.com`.toLowerCase() })).id;
      created.push(w);
      await api(`/workers/${w}/right-to-work`, { method: 'PUT', body: { status: 'citizen', citizenProofType: 'au_passport', documentNumber: 'DEMO0000' } });
      await post(`/workers/${w}/right-to-work/verify`, { note: 'Demo data' });
      await post(`/workers/${w}/employment`, { employmentType: type, contractedHours: HOURS[type], startsOn: addDays(today, -180) });
      const r = pack.roles.find(x => x.name === role)!;
      for (const name of [...(r.must ?? []), ...(r.should ?? [])]) {
        const tid = typeId.get(name.toLowerCase());
        const lib = libs.get(name);
        if (!tid || !lib) continue;
        const expiry = lib.expiry ? addDays(today, 150 + ((k * 53 + name.length * 11) % 600)) : undefined;
        const c = await post(`/workers/${w}/credentials`, {
          credentialTypeId: tid, number: lib.number ? `DEMO-${k}${name.length}` : undefined, issueDate: addDays(today, -200), expiryDate: expiry,
        });
        await post(`/workers/${w}/credentials/${c.id}/verify`, { note: 'Demo data' });
      }
    };
    for (let j = 0; j < people.length; j += 4) await Promise.all(people.slice(j, j + 4).map(addOne));

    await completeDemoCredentials({ workerIds: created }); // also meets the business's own rules (e.g. a police check for everyone)

    const eqTypes = await api<{ id: string; name: string }[]>('/equipment-types');
    for (const et of pack.equipmentTypes) {
      const t = eqTypes.find(x => x.name.toLowerCase() === et.name.toLowerCase());
      if (!t) continue;
      try {
        const e = await post('/equipment', { equipmentTypeId: t.id, name: `${et.name} 1` });
        await post(`/equipment/${e.id}/checks`, { name: 'Service', dueOn: addDays(today, 40 + (et.name.length * 9) % 200) });
      } catch { /* already there */ }
    }
  }, `Added demo staff for ${id}: two ready-to-work people per role, plus one of each equipment type. All invented.`);
}

/** Staging only: makes every demo person (email @example.com) meet this business's current rules. */
export async function completeDemo() {
  if (process.env.DEMO_TOOLS !== 'on') return;
  await attempt('/settings', () => completeDemoCredentials(), 'Demo staff now hold every credential your rules ask for.');
}
