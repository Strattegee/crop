import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { makeWords } from '../src/terms/words.js';
import {
  answerRefusal, askRefusal, decideRefusal, swapAskedEmail, swapDeclinedEmail, swapModeLabel, swapOutcomeEmail, swapStateLine, swapSummary,
  swapToApproveEmail, withdrawRefusal, type AskFacts,
} from '../src/roster/swaps.js';
import { startFakeIdp } from './fake-idp.js';

const A = { localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00', role: 'Chef', site: 'Harbour Kitchen', area: 'Kitchen' };
const B = { localDate: '2026-11-10', localStart: '15:00', localEnd: '23:00', role: 'Chef', site: 'Harbour Kitchen', area: null };

describe('shift swaps: pure rules and wording', () => {
  const ok: AskFacts = { mode: 'approve', onShift: true, started: false, cancelled: false, published: true, openSwap: false, colleagueActive: true };

  it('says why someone can\'t ask', () => {
    expect(askRefusal(ok)).toBeNull();
    expect(askRefusal({ ...ok, mode: 'off' })).toBe("Swapping shifts isn't turned on here. Contact the office.");
    expect(askRefusal({ ...ok, onShift: false })).toBe("You aren't on this shift");
    expect(askRefusal({ ...ok, cancelled: true })).toBe('This shift is cancelled');
    expect(askRefusal({ ...ok, started: true })).toBe('This shift has already started');
    expect(askRefusal({ ...ok, published: false })).toBe("This shift isn't on a published roster yet");
    expect(askRefusal({ ...ok, openSwap: true })).toMatch(/already asked/);
    expect(askRefusal({ ...ok, colleagueActive: false })).toBe('Choose someone to swap with');
    const other = { colleagueOnIt: true, started: false, cancelled: false, published: true, sameShift: false };
    expect(askRefusal({ ...ok, other })).toBeNull();
    expect(askRefusal({ ...ok, other: { ...other, colleagueOnIt: false } })).toBe("They aren't on that shift");
    expect(askRefusal({ ...ok, other: { ...other, published: false } })).toBe("That shift isn't on a published roster yet");
    expect(askRefusal({ ...ok, other: { ...other, sameShift: true } })).toBe('Choose a different shift to swap for');
    const jobs = makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }]);
    expect(askRefusal({ ...ok, mode: 'off' }, jobs)).toBe("Swapping jobs isn't turned on here. Contact the office.");
  });

  it('only lets each step happen at the right time', () => {
    expect(answerRefusal('asked')).toBeNull();
    expect(answerRefusal('agreed')).toMatch(/waiting for the office/);
    expect(answerRefusal('withdrawn')).toBe('This swap was taken back');
    expect(decideRefusal('agreed')).toBeNull();
    expect(decideRefusal('asked')).toBe("The colleague hasn't answered yet");
    expect(decideRefusal('done')).toBe('This swap has already been made');
    expect(withdrawRefusal('asked')).toBeNull();
    expect(withdrawRefusal('agreed')).toBeNull();
    expect(withdrawRefusal('closed')).toMatch(/closed/);
    expect(swapStateLine('asked', true)).toBe('Waiting for their answer');
    expect(swapStateLine('asked', false)).toBe('Waiting for your answer');
    expect(swapStateLine('declined', false)).toBe('You said no');
    expect(swapModeLabel('off')).toBe("Off: workers can't swap shifts in the app");
  });

  it('words lists and emails without anything about the people beyond names and shifts', () => {
    const give = { fromName: 'Ana Example', toName: 'Ben Example', shift: A, other: null };
    const swap = { ...give, other: B };
    expect(swapSummary(give)).toBe('Ana Example asks Ben Example to take Mon 9 Nov, 07:00–15:00, Chef at Harbour Kitchen (Kitchen)');
    expect(swapSummary(swap)).toBe('Ana Example and Ben Example swap: Ana Example gives Mon 9 Nov, 07:00–15:00, Chef at Harbour Kitchen (Kitchen); Ben Example gives Tue 10 Nov, 15:00–23:00, Chef at Harbour Kitchen');
    const asked = swapAskedEmail({ ...swap, toFirstName: 'Ben', business: 'Demo Cafe' });
    expect(asked.subject).toBe('Ana Example asks to swap shifts with you');
    expect(asked.body).toContain('You would work: Mon 9 Nov, 07:00–15:00');
    expect(asked.body).toContain('They would work yours: Tue 10 Nov, 15:00–23:00');
    expect(swapAskedEmail({ ...give, toFirstName: 'Ben', business: 'Demo Cafe' }).subject).toBe('Ana Example asks you to take a shift');
    expect(swapDeclinedEmail({ ...give, fromFirstName: 'Ana' }).body).toContain('Ben Example said no to taking Mon 9 Nov');
    const office = swapToApproveEmail(swap, 'https://crop.test/');
    expect(office.subject).toBe('Shift swap to approve: Ana Example and Ben Example');
    expect(office.body).toContain('https://crop.test/dashboard');
    const done = swapOutcomeEmail({ ...swap, firstName: 'Ana', isAsker: true }, 'done');
    expect(done.body).toContain('You are now on Tue 10 Nov, 15:00–23:00');
    expect(done.body).toContain('You are no longer on Mon 9 Nov, 07:00–15:00');
    const taker = swapOutcomeEmail({ ...give, firstName: 'Ben', isAsker: false }, 'done');
    expect(taker.body).toContain('You are now on Mon 9 Nov');
    expect(taker.body).not.toContain('no longer');
    expect(swapOutcomeEmail({ ...swap, firstName: 'Ben', isAsker: false }, 'refused').subject).toBe('Shift swap not approved');
  });
});

/** The Monday at least a week ahead, plus `weeks` weeks, plus `day` days (YYYY-MM-DD). */
function ahead(weeks: number, day = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7 + ((8 - d.getUTCDay()) % 7) + weeks * 7 + day);
  return d.toISOString().slice(0, 10);
}

describe('shift swaps: asking, answering and approving', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, area: string;
  const people: Record<string, string> = {};
  let s1: string, s2: string, later: string;

  const shift = async (date: string, startTime = '07:00', endTime = '15:00', role = 'Chef') =>
    (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, areaId: area, role, date, startTime, endTime }).expect(201)).body.ids[0] as string;
  const signIn = async (sub: string, email: string) => {
    idp.addUser({ sub, email, email_verified: true, name: sub });
    tok[sub] = await idp.token(sub, { expiresIn: '1h' });
  };
  const onShift = async (shiftId: string) => (await owner.query(
    `select w.first_name as name, sa.status from shift_assignments sa join workers w on w.id = sa.worker_id
      where sa.shift_id = $1 and sa.status in ('assigned', 'confirmed')`, [shiftId])).rows;
  const sent = async (template: string) => (await owner.query(
    'select to_address as to, subject, body from notifications where template = $1 order by created_at', [template])).rows;

  beforeAll(async () => {
    db = await createTestDatabase('crop_swaps');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [id('cafe'), id('other')]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) await signIn(sub, email);
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud', APP_URL: 'https://crop.test' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    area = (await http().post(`/facilities/${site}/areas`).set(as('admin')).send({ name: 'Kitchen' }).expect(201)).body.id;
    for (const [name, role] of [['Ana', 'Chef'], ['Ben', 'Chef'], ['Cal', 'Chef'], ['Dee', 'Waiter']]) {
      const sub = name.toLowerCase();
      const w = (await http().post('/workers').set(as('admin')).send({ firstName: name, lastName: 'Example', roles: [role], email: `${sub}@example.com` }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/employment`).set(as('admin')).send({ employmentType: 'casual', startsOn: '2026-01-01' }).expect(201);
      await http().post(`/workers/${w}/app-access`).set(as('admin')).expect(201);
      await signIn(sub, `${sub}@example.com`);
      await http().get('/my').set(as(sub)).expect(200);
      people[sub] = w;
    }
    s1 = await shift(ahead(0, 1));
    s2 = await shift(ahead(0, 2), '15:00', '23:00');
    later = await shift(ahead(2, 1));
    await http().post(`/shifts/${s1}/assign`).set(as('alloc')).send({ workerId: people.ana }).expect(200);
    await http().post(`/shifts/${s2}/assign`).set(as('alloc')).send({ workerId: people.ben }).expect(200);
    await http().post(`/shifts/${later}/assign`).set(as('alloc')).send({ workerId: people.ana }).expect(200);
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: ahead(0), facilityId: site, notify: false }).expect(201);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('is off until an owner or admin turns it on', async () => {
    expect((await http().get('/settings').set(as('alloc')).expect(200)).body.shiftSwaps).toBe('off');
    const r = await http().post('/my/swaps').set(as('ana')).send({ shiftId: s1, workerId: people.cal }).expect(409);
    expect(r.body.message).toBe("Swapping shifts isn't turned on here. Contact the office.");
    expect((await http().get('/my/swaps').set(as('ana')).expect(200)).body).toEqual({ mode: 'off', swaps: [] });
    await http().patch('/settings').set(as('alloc')).send({ shiftSwaps: 'approve' }).expect(403);
    await http().patch('/settings').set(as('admin')).send({ shiftSwaps: 'sometimes' }).expect(400);
    expect((await http().patch('/settings').set(as('admin')).send({ shiftSwaps: 'approve' }).expect(200)).body.shiftSwaps).toBe('approve');
  });

  it('lists who could take a shift or swap for it, only people who pass every rule', async () => {
    const o = (await http().get(`/my/swaps/options?shiftId=${s1}`).set(as('ana')).expect(200)).body;
    // Dee isn't a chef, so isn't offered; nobody's reasons are shown.
    expect(o.takers.map((x: { name: string }) => x.name)).toEqual(['Ben Example', 'Cal Example']);
    expect(o.swaps).toEqual([expect.objectContaining({ shiftId: s2, workerId: people.ben, name: 'Ben Example' })]);
    expect(JSON.stringify(o)).not.toMatch(/blocks|warnings|email/);
    await http().get(`/my/swaps/options?shiftId=${s2}`).set(as('ana')).expect(403);
    // A week that isn't published yet can't be swapped.
    expect((await http().get(`/my/swaps/options?shiftId=${later}`).set(as('ana')).expect(409)).body.message)
      .toBe("This shift isn't on a published roster yet");
  });

  it('refuses asks the rules would stop, and changes nothing', async () => {
    const dee = await http().post('/my/swaps').set(as('ana')).send({ shiftId: s1, workerId: people.dee }).expect(409);
    expect(dee.body.message).toMatch(/^Dee Example can't work that shift: Dee Example doesn't have the role Chef/);
    await http().post('/my/swaps').set(as('ana')).send({ shiftId: s2, workerId: people.cal }).expect(409);
    await http().post('/my/swaps').set(as('ana')).send({ shiftId: s1, workerId: people.ana }).expect(409);
    await http().post('/my/swaps').set(as('ana')).send({ shiftId: s1, workerId: people.cal, otherShiftId: s2 }).expect(409);
    expect((await owner.query('select count(*)::int as n from shift_swaps')).rows[0].n).toBe(0);
    expect(await onShift(s1)).toEqual([{ name: 'Ana', status: 'assigned' }]);
  });

  it('asks a colleague to take a shift; they can say no', async () => {
    const r = (await http().post('/my/swaps').set(as('ana')).send({ shiftId: s1, workerId: people.cal }).expect(201)).body;
    expect(r).toMatchObject({ status: 'asked', mine: true, colleague: 'Cal Example', canWithdraw: true, canAnswer: false, stateLine: 'Waiting for their answer' });
    const asked = await sent('shift_swap_asked');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ to: 'cal@example.com', subject: 'Ana Example asks you to take a shift' });
    // Only one open ask per shift.
    expect((await http().post('/my/swaps').set(as('ana')).send({ shiftId: s1, workerId: people.ben }).expect(409)).body.message).toMatch(/already asked/);
    const cal = (await http().get('/my/swaps').set(as('cal')).expect(200)).body.swaps;
    expect(cal).toEqual([expect.objectContaining({ id: r.id, mine: false, canAnswer: true, stateLine: 'Waiting for your answer' })]);
    // Only Cal can answer, only Ana can take it back.
    await http().post(`/my/swaps/${r.id}/accept`).set(as('ben')).expect(403);
    await http().post(`/my/swaps/${r.id}/withdraw`).set(as('cal')).expect(403);
    expect((await http().post(`/my/swaps/${r.id}/decline`).set(as('cal')).expect(200)).body).toMatchObject({ status: 'declined', stateLine: 'You said no' });
    expect((await sent('shift_swap_declined'))[0]).toMatchObject({ to: 'ana@example.com', subject: "Cal Example can't take your shift" });
    await http().post(`/my/swaps/${r.id}/accept`).set(as('cal')).expect(409);
    expect(await onShift(s1)).toEqual([{ name: 'Ana', status: 'assigned' }]);
  });

  it('swaps two shifts once both agree and an owner or admin approves', async () => {
    await http().post('/push-devices').set(as('admin')).send({ token: 'ExponentPushToken[admin-swaps]', platform: 'android' }).expect(204);
    await http().post('/push-devices').set(as('alloc')).send({ token: 'ExponentPushToken[alloc-swaps]', platform: 'android' }).expect(204);
    const r = (await http().post('/my/swaps').set(as('ana')).send({ shiftId: s1, workerId: people.ben, otherShiftId: s2 }).expect(201)).body;
    expect((await http().post(`/my/swaps/${r.id}/accept`).set(as('ben')).expect(200)).body).toMatchObject({ status: 'agreed', stateLine: 'Agreed. Waiting for the office to approve' });
    expect(await onShift(s1)).toEqual([{ name: 'Ana', status: 'assigned' }]);
    expect((await sent('shift_swap_to_approve')).map(m => m.to)).toEqual(['admin@x.com']);
    // And the deciders' phones (not the allocator's), naming only the people and shifts.
    const alerts = await sent('office_swap_to_approve');
    expect(alerts.map(m => m.to)).toEqual(['ExponentPushToken[admin-swaps]']);
    expect(alerts[0].subject).toBe('Shift swap to approve: Ana Example and Ben Example');
    expect(alerts[0].body).toMatch(/^Ana Example's \w{3} \d+ \w{3} 07:00–15:00 for Ben Example's \w{3} \d+ \w{3} 15:00–23:00 at Harbour Kitchen\. Open CROP to approve or not\.$/);
    const list = (await http().get('/shift-swaps').set(as('alloc')).expect(200)).body;
    expect(list.mode).toBe('approve');
    expect(list.swaps).toEqual([expect.objectContaining({ id: r.id, status: 'agreed', canDecide: false, fromName: 'Ana Example', toName: 'Ben Example' })]);
    expect((await http().get('/shift-swaps').set(as('admin')).expect(200)).body.swaps[0].canDecide).toBe(true);
    await http().post(`/shift-swaps/${r.id}/approve`).set(as('alloc')).expect(403);
    await http().get('/shift-swaps').set(as('ana')).expect(403);
    // Another business sees nothing.
    expect((await http().get('/shift-swaps').set(as('other')).expect(200)).body.swaps).toEqual([]);
    await http().post(`/shift-swaps/${r.id}/approve`).set(as('other')).expect(404);

    const done = (await http().post(`/shift-swaps/${r.id}/approve`).set(as('admin')).expect(200)).body;
    expect(done).toMatchObject({ status: 'done', decidedByName: expect.any(String) });
    expect(await onShift(s1)).toEqual([{ name: 'Ben', status: 'confirmed' }]);
    expect(await onShift(s2)).toEqual([{ name: 'Ana', status: 'confirmed' }]);
    expect((await owner.query(`select removed_reason from shift_assignments where shift_id = $1 and status = 'removed'`, [s1])).rows).toEqual([{ removed_reason: 'swap' }]);
    expect((await sent('shift_swap_done')).map(m => m.to).sort()).toEqual(['ana@example.com', 'ben@example.com']);
    // The roster's change log shows it, after publishing.
    const log = (await owner.query(`select kind, after_publish from shift_changes where shift_id = $1 order by id`, [s1])).rows;
    expect(log.slice(-2).map(l => l.kind)).toEqual(['assigned', 'confirmed']);
    expect(log.at(-1).after_publish).toBe(true);
    await http().post(`/shift-swaps/${r.id}/approve`).set(as('admin')).expect(409);
  });

  it('closes an open ask when someone comes off the shift another way', async () => {
    const r = (await http().post('/my/swaps').set(as('ana')).send({ shiftId: s2, workerId: people.cal }).expect(201)).body;
    await http().post(`/shifts/${s2}/unassign`).set(as('alloc')).send({}).expect(200);
    expect((await http().get('/my/swaps').set(as('ana')).expect(200)).body.swaps.find((x: { id: string }) => x.id === r.id))
      .toMatchObject({ status: 'closed', canWithdraw: false });
    expect((await http().post(`/my/swaps/${r.id}/accept`).set(as('cal')).expect(409)).body.message).toMatch(/closed/);
    await http().post(`/shifts/${s2}/assign`).set(as('alloc')).send({ workerId: people.ana }).expect(200);
  });

  it('can be taken back, or refused by the office', async () => {
    const a = (await http().post('/my/swaps').set(as('ana')).send({ shiftId: s2, workerId: people.cal }).expect(201)).body;
    expect((await http().post(`/my/swaps/${a.id}/withdraw`).set(as('ana')).expect(200)).body).toMatchObject({ status: 'withdrawn', stateLine: 'You took it back' });
    const b = (await http().post('/my/swaps').set(as('ana')).send({ shiftId: s2, workerId: people.cal }).expect(201)).body;
    await http().post(`/shift-swaps/${b.id}/refuse`).set(as('admin')).send({}).expect(409); // Cal hasn't answered
    await http().post(`/my/swaps/${b.id}/accept`).set(as('cal')).expect(200);
    expect((await http().post(`/shift-swaps/${b.id}/refuse`).set(as('admin')).send({ reason: 'Cal is training that day' }).expect(200)).body)
      .toMatchObject({ status: 'refused', reason: 'Cal is training that day' });
    expect(await onShift(s2)).toEqual([{ name: 'Ana', status: 'assigned' }]);
    const told = await sent('shift_swap_refused');
    expect(told.map(m => m.to).sort()).toEqual(['ana@example.com', 'cal@example.com']);
    // The office's note stays with the office.
    expect(told.every(m => !m.body.includes('training'))).toBe(true);
  });

  it('makes the swap at once when the business chooses automatic', async () => {
    await http().patch('/settings').set(as('admin')).send({ shiftSwaps: 'automatic' }).expect(200);
    const r = (await http().post('/my/swaps').set(as('ana')).send({ shiftId: s2, workerId: people.cal }).expect(201)).body;
    expect((await http().post(`/my/swaps/${r.id}/accept`).set(as('cal')).expect(200)).body).toMatchObject({ status: 'done', stateLine: 'Swapped' });
    expect(await onShift(s2)).toEqual([{ name: 'Cal', status: 'confirmed' }]);
    const via = (await owner.query(`select via from shift_changes where shift_id = $1 order by id desc limit 1`, [s2])).rows[0].via;
    expect(via).toBe('app');
  });

  it('follows the after-publishing lock', async () => {
    await http().patch('/settings').set(as('admin')).send({ publishedChanges: 'locked' }).expect(200);
    const r = await http().post('/my/swaps').set(as('cal')).send({ shiftId: s2, workerId: people.ana }).expect(409);
    expect(r.body.message).toMatch(/can't be changed now/);
    await http().patch('/settings').set(as('admin')).send({ publishedChanges: 'open' }).expect(200);
  });

  it('keeps every swap in the audit log and never lets the app delete one', async () => {
    expect((await owner.query(`select count(*)::int as n from audit_log where table_name = 'shift_swaps'`)).rows[0].n).toBeGreaterThan(0);
    const appDb = new Client({ connectionString: db.appUrl });
    await appDb.connect();
    try {
      await expect(appDb.query('delete from shift_swaps')).rejects.toThrow(/permission denied/);
    } finally {
      await appDb.end();
    }
  });
});
