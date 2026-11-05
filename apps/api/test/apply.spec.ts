import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { createPool, withTenant } from '@crop/db';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { DOCUMENT_STORE, MemoryStore } from '../src/documents/document-store.js';
import {
  answerLines, applyFloodRefusal, ApplyProblem, availabilityLine, clientIp, confirmEmail, confirmState, formOf, FormProblem, formToken,
  formTokenRefusal, ipHash, looksAutomated, officeEmail, parseApplication, parseBuiltIn, parseCustom, turnstileKeys, verifyTurnstile,
  type ApplyForm,
} from '../src/workforce/apply-form.js';
import { startFakeIdp } from './fake-idp.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const CTX = { country: 'AU' as const, roles: ['Barista', 'Cook'], credentialTypeIds: ['c1', 'c2'] };
const ANSWERS = {
  firstName: 'Sam', lastName: 'Example', email: 'Sam@Example.com', mobile: '0412 345 678', suburb: 'Fitzroy', region: 'vic', postcode: '3065',
  roles: ['Barista'], workTypes: ['casual'], availability: [{ weekday: 1, periods: ['am', 'pm'] }, { weekday: 6, periods: ['night'] }],
  rightToWork: 'yes', rightToWorkStatus: 'citizen', driversLicence: 'yes', ownCar: 'no', credentials: ['c1'], about: 'I like coffee.',
  heardFrom: 'other', heardOther: 'A poster', consent: true,
};

describe('applying online: rules', () => {
  const form: ApplyForm = formOf({ custom: [{ id: 'qshoe', label: 'Shoe size', help: null, type: 'choice', required: true, choices: ['Small', 'Large'] }] });

  it('fills CROP’s defaults and keeps the business’s choices within what each question allows', () => {
    const f = formOf({ builtIn: { mobile: 'off', name: 'off', credentials: 'required' } });
    expect(f.builtIn).toMatchObject({ mobile: 'off', name: 'required', credentials: 'optional', right_to_work: 'required', cv: 'optional' });
    expect(parseBuiltIn({ cv: 'required' }, f.builtIn).cv).toBe('required');
    expect(() => parseBuiltIn({ email: 'off' }, f.builtIn)).toThrow(FormProblem);
    expect(() => parseBuiltIn({ nope: 'off' }, f.builtIn)).toThrow('There is no question called nope');
  });

  it('checks the business’s own questions', () => {
    let n = 0;
    const qs = parseCustom([{ label: ' Shoe  size ', type: 'choice', choices: ['S', 'L', 'S'], required: true }, { id: 'qkeep01', label: 'Forklift?', type: 'yes_no' }], () => `qnew${++n}`);
    expect(qs).toEqual([
      { id: 'qnew1', label: 'Shoe size', help: null, type: 'choice', required: true, choices: ['S', 'L'] },
      { id: 'qkeep01', label: 'Forklift?', help: null, type: 'yes_no', required: false, choices: [] },
    ]);
    expect(() => parseCustom([{ label: 'Pick', type: 'choice', choices: ['one'] }])).toThrow('Question 1 needs at least two choices');
    expect(() => parseCustom([{ label: '', type: 'short_text' }])).toThrow('Question 1 needs some words');
    expect(() => parseCustom([{ label: 'X', type: 'essay' }])).toThrow('Choose what kind of answer question 1 takes');
  });

  it('reads an application against the form and explains problems to the applicant', () => {
    const a = parseApplication({ ...ANSWERS, custom: { qshoe: 'Large' } }, form, CTX, ['cv', 'cred_c2']);
    expect(a).toMatchObject({
      email: 'sam@example.com', mobile: '+61412345678', region: 'VIC', postcode: '3065', roles: ['Barista'], workTypes: ['casual'],
      rightToWork: 'yes', rightToWorkStatus: 'citizen', driversLicence: true, ownCar: false, credentialTypeIds: ['c1', 'c2'],
      heardFrom: 'other', heardOther: 'A poster', fileFields: ['cv', 'cred_c2'],
    });
    expect(a.availability).toHaveLength(7);
    expect(a.availability![5]).toEqual({ weekday: 6, periods: ['night'] });
    expect(a.custom).toEqual([{ id: 'qshoe', label: 'Shoe size', type: 'choice', value: 'Large' }]);
    const bad = (patch: Record<string, unknown>, files: string[] = [], f = form) => {
      try { parseApplication({ ...ANSWERS, custom: { qshoe: 'Small' }, ...patch }, f, CTX, files); return null; } catch (e) { expect(e).toBeInstanceOf(ApplyProblem); return (e as Error).message; }
    };
    expect(bad({})).toBeNull();
    expect(bad({ firstName: ' ' })).toBe('First name is needed');
    expect(bad({ email: 'nope' })).toBe('Your email doesn’t look right');
    expect(bad({ mobile: '03 9000 0000' })).toMatch(/mobile doesn’t look right/);
    expect(bad({ postcode: '30650' })).toBe('Postcode: 4 digits');
    expect(bad({ region: 'Narnia' })).toBe('Choose a state');
    expect(bad({ roles: ['Pilot'] })).toBe('Choose roles from the list');
    expect(bad({ roles: [] })).toBe('Choose the roles you’re applying for');
    expect(bad({ rightToWork: undefined })).toMatch(/right to work in Australia/);
    expect(bad({ rightToWorkStatus: 'tourist' })).toBe('Choose your right to work status');
    expect(bad({ consent: false })).toBe('Please agree to the privacy policy and worker privacy notice');
    expect(bad({ custom: {} })).toBe('Answer “Shoe size”');
    expect(bad({ custom: { qshoe: 'Huge' } })).toBe('Choose an answer to “Shoe size” from the list');
    expect(bad({}, ['q_qother'])).toBe('A file was sent for something the form doesn’t ask for');
    expect(bad({}, ['cred_c9'])).toBe('Choose qualifications from the list');
    // Questions switched off are ignored even when answered.
    const off = formOf({ builtIn: { mobile: 'off', cv: 'off' } });
    expect(parseApplication({ ...ANSWERS }, off, CTX).mobile).toBeNull();
    expect(bad({}, ['cv'], off)).toBe('A file was sent for something the form doesn’t ask for');
  });

  it('refuses forged, too-fast and stale forms, counts limits and keys IP addresses', () => {
    const key = Buffer.alloc(32, 7);
    const now = Date.parse('2026-11-05T10:00:00Z');
    const t = formToken(key, 'c4u', now - 10_000);
    expect(formTokenRefusal(t, key, 'c4u', now)).toBeNull();
    expect(formTokenRefusal(formToken(key, 'c4u', now - 2_000), key, 'c4u', now)).toMatch(/very quick/);
    expect(formTokenRefusal(formToken(key, 'c4u', now - 25 * 3600_000), key, 'c4u', now)).toMatch(/open a long time/);
    expect(formTokenRefusal(t, key, 'other', now)).toMatch(/open the form again/);
    expect(formTokenRefusal(t, Buffer.alloc(32, 8), 'c4u', now)).toMatch(/open the form again/);
    expect(formTokenRefusal(undefined, key, 'c4u', now)).toMatch(/open the form again/);
    expect(applyFloodRefusal({ ipHour: 4, businessHour: 29, emailDay: 2 })).toBeNull();
    expect(applyFloodRefusal({ ipHour: 5, businessHour: 0, emailDay: 0 })).toMatch(/from your connection/);
    expect(applyFloodRefusal({ ipHour: 0, businessHour: 30, emailDay: 0 })).toMatch(/a lot of applications/);
    expect(applyFloodRefusal({ ipHour: 0, businessHour: 0, emailDay: 3 })).toMatch(/already have applications from this email/);
    expect(ipHash(key, '203.0.113.9').equals(ipHash(key, '203.0.113.9'))).toBe(true);
    expect(ipHash(key, '203.0.113.9').toString('hex')).not.toContain('203');
    expect(clientIp('203.0.113.9, 10.0.0.2', '10.0.0.3')).toBe('203.0.113.9');
    expect(clientIp(undefined, '::ffff:10.0.0.3')).toBe('10.0.0.3');
    expect(looksAutomated({ website: 'x' })).toBe(true);
  });

  it('runs out confirmation links after 48 hours and words the messages', () => {
    const now = new Date('2026-11-05T10:00:00Z');
    expect(confirmState({ status: 'pending', linkExpiresAt: '2026-11-05T11:00:00Z' }, now)).toBe('ok');
    expect(confirmState({ status: 'pending', linkExpiresAt: '2026-11-05T09:00:00Z' }, now)).toBe('expired');
    expect(confirmState({ status: 'confirmed', linkExpiresAt: '2026-11-05T09:00:00Z' }, now)).toBe('confirmed');
    expect(confirmEmail({ firstName: 'Sam', business: 'Sample Cafe', url: 'https://x/apply/c/confirm/t' }).body).toContain('within 48 hours');
    const o = officeEmail({ name: 'Sam Example', roles: ['Barista'], workerId: 'w1', existing: null }, 'https://crop.example/');
    expect(o.subject).toBe('New application: Sam Example');
    expect(o.body).toContain('https://crop.example/workers/w1');
    expect(availabilityLine([{ weekday: 1, periods: ['am', 'pm'] }, { weekday: 2, periods: [] }])).toBe('Mon AM PM');
    const lines = answerLines(parseApplication({ ...ANSWERS, custom: { qshoe: 'Large' } }, form, CTX), new Map([['c1', 'RSA']]), 'AU');
    expect(lines).toContainEqual({ label: 'Right to work', value: 'Says: Australian citizen – not checked' });
    expect(lines).toContainEqual({ label: 'Qualifications they say they hold', value: 'RSA' });
    expect(lines).toContainEqual({ label: 'Shoe size', value: 'Large' });
    expect(lines).toContainEqual({ label: 'Heard about you', value: 'Somewhere else: A poster' });
  });

  it('switches Turnstile on only with both keys and treats any failure as not passed', async () => {
    expect(turnstileKeys({ TURNSTILE_SITE_KEY: 'a' })).toBeNull();
    expect(turnstileKeys({ TURNSTILE_SITE_KEY: 'a', TURNSTILE_SECRET_KEY: 'b' })).toEqual({ siteKey: 'a', secret: 'b' });
    const ok = async () => ({ ok: true, json: async () => ({ success: true }) });
    const no = async () => ({ ok: true, json: async () => ({ success: false }) });
    const boom = async () => { throw new Error('down'); };
    expect(await verifyTurnstile('s', 'tok', '1.2.3.4', ok)).toBe(true);
    expect(await verifyTurnstile('s', 'tok', '1.2.3.4', no)).toBe(false);
    expect(await verifyTurnstile('s', 'tok', '1.2.3.4', boom)).toBe(false);
    expect(await verifyTurnstile('s', '', '1.2.3.4', ok)).toBe(false);
  });
});

describe('applying online: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let appPool: Pool;
  const store = new MemoryStore();
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  let ip = 1;

  /** A form stamp from 10 seconds ago (signed with the business's key, as the page would have it). */
  const stamp = async (slug = 'c4u', ago = 10_000) => {
    const key = (await owner.query<{ key: Buffer }>('select key from apply_form_keys where tenant_id = $1', [ids[slug]])).rows[0].key;
    return formToken(key, slug, Date.now() - ago);
  };
  const send = async (answers: Record<string, unknown>, opts: { files?: [string, Buffer, string][]; token?: string; website?: string; from?: string } = {}) => {
    let r = http().post('/apply/c4u').set('x-forwarded-for', opts.from ?? `198.51.100.${ip++}`)
      .field('answers', JSON.stringify(answers)).field('formToken', opts.token ?? await stamp());
    if (opts.website) r = r.field('website', opts.website);
    for (const [f, b, n] of opts.files ?? []) r = r.attach(f, b, n);
    // supertest requests are thenable: hand back a plain object so awaiting this helper doesn't send it.
    return { expect: (code: number) => r.expect(code) };
  };
  const confirmToken = async (email: string) => {
    const n = (await owner.query<{ body: string }>(`select body from notifications where template = 'job_application_confirm' and to_address = $1 order by created_at desc limit 1`, [email])).rows[0];
    return n.body.match(/\/confirm\/([A-Za-z0-9_-]{43})/)![1];
  };

  beforeAll(async () => {
    process.env.NOTIFY_DISPATCH = 'off';
    process.env.APP_URL = 'https://crop.example';
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    db = await createTestDatabase('crop_apply');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('c4u','Caring Example'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'nosy@x.com','owner')`, [ids.c4u, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    await owner.query(`insert into business_roles(tenant_id, name) values ($1,'Barista'),($1,'Cook')`, [ids.c4u]);
    const c = await owner.query<{ id: string; name: string }>(
      `insert into credential_types(tenant_id, name, category) values ($1,'RSA','licence'),($1,'Flu vaccination','vaccination') returning id, name`, [ids.c4u]);
    for (const r of c.rows) ids[r.name] = r.id;
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DOCUMENT_STORE).useValue(store).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    appPool = createPool(db.appUrl);
  });

  afterAll(async () => {
    await appPool?.end();
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('is closed until an owner or admin opens it, and never says which businesses exist', async () => {
    const closed = await http().get('/apply/c4u').expect(404);
    const none = await http().get('/apply/no-such-business').expect(404);
    expect(closed.body.message).toBe(none.body.message);
    await http().post('/apply/c4u').field('answers', '{}').expect(404);
    expect((await http().get('/apply-form').set(as('alloc')).expect(200)).body).toMatchObject({ open: false, slug: 'c4u' });
    await http().put('/apply-form').set(as('alloc')).send({ open: true }).expect(403);
    await http().put('/apply-form').set(as('admin')).send({ builtIn: { email: 'off' } }).expect(400);
    const on = await http().put('/apply-form').set(as('admin')).send({
      open: true, intro: 'Join our team.', builtIn: { cv: 'optional', heard: 'off' },
      custom: [{ label: 'Can you work weekends?', type: 'yes_no', required: true }],
    }).expect(200);
    expect(on.body).toMatchObject({ open: true, intro: 'Join our team.' });
    ids.q = on.body.custom[0].id;
    const page = (await http().get('/apply/c4u').expect(200)).body;
    expect(page).toMatchObject({ business: 'Caring Example', intro: 'Join our team.', country: 'AU', turnstileSiteKey: null });
    expect(page.formToken).toMatch(/\./);
    expect(page.questions.map((q: { key: string }) => q.key)).not.toContain('heard');
    expect(page.roles.map((r: { name: string }) => r.name)).toEqual(['Barista', 'Cook']);
    // Vaccinations are never asked about.
    expect(page.credentials.map((r: { name: string }) => r.name)).toEqual(['RSA']);
    expect((await http().get('/apply-form/preview').set(as('alloc')).expect(200)).body.formToken).toBeNull();
  });

  it('keeps nothing a robot sends and refuses a form sent too fast', async () => {
    const answers = { ...ANSWERS, credentials: [], email: 'robot@example.com', custom: { [ids.q]: 'yes' } };
    await (await send(answers, { website: 'http://spam.example' })).expect(200);
    const fast = await (await send(answers, { token: await stamp('c4u', 1000) })).expect(400);
    expect(fast.body.message).toMatch(/very quick/);
    await (await send(answers, { token: 'forged.token' })).expect(400);
    expect((await owner.query('select count(*)::int as n from job_applications')).rows[0].n).toBe(0);
  });

  it('waits for the email to be confirmed, then adds the applicant at Applied once and tells the office', async () => {
    const answers = { ...ANSWERS, credentials: [ids.RSA], custom: { [ids.q]: 'yes' } };
    await (await send({ ...answers, consent: false })).expect(400);
    await (await send(answers, { files: [['cv', Buffer.from('not a real file'), 'cv.docx']] })).expect(400);
    expect(store.objects.size).toBe(0);
    const r = await (await send(answers, { files: [['cv', PDF, 'cv.pdf'], [`cred_${ids.RSA}`, PDF, 'rsa.pdf']] })).expect(200);
    expect(r.body).toMatchObject({ received: true });
    expect(store.objects.size).toBe(2);
    // Nothing reaches the office before confirmation.
    expect((await owner.query(`select count(*)::int as n from workers where tenant_id = $1`, [ids.c4u])).rows[0].n).toBe(0);
    expect((await owner.query(`select count(*)::int as n from notifications where template = 'job_application'`)).rows[0].n).toBe(0);
    const stored = (await owner.query(`select ip_hash, status from job_applications`)).rows[0];
    expect(stored.status).toBe('pending');
    expect(stored.ip_hash.toString()).not.toContain('198.51');
    const token = await confirmToken('sam@example.com');
    expect((await http().get(`/apply-confirm/${token}`).expect(200)).body).toEqual({ business: 'Caring Example', firstName: 'Sam', state: 'ok' });
    await http().get('/apply-confirm/short').expect(404);
    expect((await http().post(`/apply-confirm/${token}`).expect(200)).body.state).toBe('confirmed');
    expect((await http().post(`/apply-confirm/${token}`).expect(200)).body.state).toBe('confirmed');
    const people = (await owner.query(`select id, status, recruitment_stage, phone, roles from workers where tenant_id = $1`, [ids.c4u])).rows;
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ status: 'applicant', recruitment_stage: 'applied', phone: '+61412345678', roles: ['Barista'] });
    ids.sam = people[0].id;
    const ev = (await owner.query(`select to_stage, note from recruitment_events where worker_id = $1`, [ids.sam])).rows;
    expect(ev).toEqual([{ to_stage: 'applied', note: 'Applied online' }]);
    expect((await owner.query(`select postcode, is_current from worker_addresses where worker_id = $1`, [ids.sam])).rows).toEqual([{ postcode: '3065', is_current: true }]);
    expect((await owner.query(`select weekday, periods from availability_patterns where worker_id = $1 and cardinality(periods) > 0 order by weekday`, [ids.sam])).rows)
      .toEqual([{ weekday: 1, periods: ['am', 'pm'] }, { weekday: 6, periods: ['night'] }]);
    const cred = (await owner.query(`select verification, evidence from worker_credentials where worker_id = $1`, [ids.sam])).rows;
    expect(cred).toEqual([{ verification: 'unverified', evidence: 'uploaded' }]);
    const office = (await owner.query(`select to_address, subject, body from notifications where template = 'job_application'`)).rows;
    expect(office.map(o => o.to_address)).toEqual(['admin@x.com']);
    expect(office[0].subject).toBe('New application: Sam Example');
    expect(office[0].body).not.toMatch(/citizen|coffee/);
    expect((await owner.query(`select count(*)::int as n from notifications where template = 'job_application_received'`)).rows[0].n).toBe(1);
    // The board marks it, and the person's page shows the answers and files.
    const board = (await http().get('/recruitment').set(as('alloc')).expect(200)).body;
    expect(board.columns[0].people[0]).toMatchObject({ id: ids.sam, appliedOnline: true });
    const apps = (await http().get(`/workers/${ids.sam}/applications`).set(as('alloc')).expect(200)).body;
    expect(apps[0].answers).toContainEqual({ label: 'Right to work', value: 'Says: Australian citizen – not checked' });
    expect(apps[0].answers).toContainEqual({ label: 'Can you work weekends?', value: 'Yes' });
    expect(apps[0].files.map((f: { label: string }) => f.label).sort()).toEqual(['CV', 'RSA']);
    const link = (await http().get(`/job-application-files/${apps[0].files[0].id}/link`).set(as('alloc')).expect(200)).body;
    expect(link.url).toMatch(/^https:\/\/storage.test\//);
    // Another business sees nothing; content can't be edited.
    expect((await withTenant(appPool, ids.nosy, d => d.query('select * from job_applications'))).rows).toEqual([]);
    await http().get(`/workers/${ids.sam}/applications`).set(as('nosy')).expect(200).expect([]);
    await expect(withTenant(appPool, ids.c4u, d => d.query(`update job_applications set first_name = 'X'`))).rejects.toThrow();
    await expect(withTenant(appPool, ids.c4u, d => d.query(`delete from job_applications`))).resolves.toMatchObject({ rowCount: 0 });
  });

  it('adds a second application from the same email to that person instead of a duplicate', async () => {
    await (await send({ ...ANSWERS, credentials: [], roles: ['Cook'], custom: { [ids.q]: 'no' } })).expect(200);
    await http().post(`/apply-confirm/${await confirmToken('sam@example.com')}`).expect(200);
    expect((await owner.query(`select count(*)::int as n from workers where tenant_id = $1`, [ids.c4u])).rows[0].n).toBe(1);
    const a = (await owner.query(`select outcome, worker_id from job_applications where status = 'confirmed' order by confirmed_at`)).rows;
    expect(a.map(x => x.outcome)).toEqual(['new_applicant', 'existing_person']);
    expect(a[1].worker_id).toBe(ids.sam);
    const mail = (await owner.query(`select subject, body from notifications where template = 'job_application' order by created_at desc limit 1`)).rows[0];
    expect(mail.subject).toBe('Sam Example applied online again');
    expect(mail.body).toContain('already on file (an applicant)');
    expect((await owner.query(`select roles from workers where id = $1`, [ids.sam])).rows[0].roles).toEqual(['Barista']);
  });

  it('limits applications per connection and per email, and runs links out', async () => {
    const answers = (email: string) => ({ ...ANSWERS, email, credentials: [], custom: { [ids.q]: 'yes' } });
    for (let i = 0; i < 3; i++) await (await send(answers(`one${i}@example.com`), { from: '192.0.2.50' })).expect(200);
    for (let i = 3; i < 5; i++) await (await send(answers(`one${i}@example.com`), { from: '192.0.2.50' })).expect(200);
    const busy = await (await send(answers('one9@example.com'), { from: '192.0.2.50' })).expect(409);
    expect(busy.body.message).toMatch(/from your connection/);
    await (await send(answers('busy@example.com'))).expect(200);
    await (await send(answers('busy@example.com'))).expect(200);
    await (await send(answers('busy@example.com'))).expect(200);
    expect((await (await send(answers('busy@example.com'))).expect(409)).body.message).toMatch(/from this email/);
    const token = await confirmToken('one0@example.com');
    await owner.query(`update job_applications set link_expires_at = now() - interval '1 minute' where email = 'one0@example.com'`);
    expect((await http().get(`/apply-confirm/${token}`).expect(200)).body.state).toBe('expired');
    expect((await http().post(`/apply-confirm/${token}`).expect(409)).body.message).toMatch(/run out/);
    // The next application clears away expired unconfirmed ones.
    await (await send(answers('later@example.com'))).expect(200);
    expect((await owner.query(`select count(*)::int as n from job_applications where email = 'one0@example.com'`)).rows[0].n).toBe(0);
  });
});
