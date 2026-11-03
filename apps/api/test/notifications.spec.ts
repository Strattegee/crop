import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { NotificationDispatcher } from '../src/notifications/dispatcher.js';
import { auMobile, mobileProblem, parseMobile, phoneSearchDigits, smsRefusal } from '../src/notifications/phone.js';
import { EMAIL_SENDER, MemoryEmail, MemorySms, SendError, SMS_SENDER, textToHtml } from '../src/notifications/senders.js';
import { startFakeIdp } from './fake-idp.js';

describe('helpers', () => {
  it('normalises Australian mobiles', () => {
    expect(auMobile('0412 345 678')).toBe('+61412345678');
    expect(auMobile('+61 412-345-678')).toBe('+61412345678');
    expect(auMobile('61412345678')).toBe('+61412345678');
    expect(auMobile('02 9876 5432')).toBeNull();
    expect(auMobile('041234567')).toBeNull();
  });
  it('reads mobiles the way each country writes them and stores them in international form', () => {
    expect(parseMobile('AU', '0412 345 678')).toEqual({ e164: '+61412345678', country: 'AU' });
    expect(parseMobile('AU', '+61 0412 345 678')).toEqual({ e164: '+61412345678', country: 'AU' });
    expect(parseMobile('NZ', '021 123 4567')).toEqual({ e164: '+64211234567', country: 'NZ' });
    expect(parseMobile('NZ', '027 123 456')).toEqual({ e164: '+6427123456', country: 'NZ' });
    expect(parseMobile('NZ', '027 123 45')).toBeNull();
    expect(parseMobile('NZ', '022 1234 5678')).toEqual({ e164: '+642212345678', country: 'NZ' });
    expect(parseMobile('NZ', '09 123 4567')).toBeNull(); // an Auckland landline
    expect(parseMobile('US', '(212) 555-0123')).toEqual({ e164: '+12125550123', country: 'US' });
    expect(parseMobile('US', '1 212 555 0123')).toEqual({ e164: '+12125550123', country: 'US' });
    expect(parseMobile('US', '212 055 0123')).toBeNull(); // exchanges never start with 0
    expect(parseMobile('GB', '07700 900123')).toEqual({ e164: '+447700900123', country: 'GB' });
    expect(parseMobile('GB', '020 7946 0000')).toBeNull(); // a London landline
    // Someone from another of CROP's countries, typed with + (or 00) and its code.
    expect(parseMobile('AU', '+64 21 123 4567')).toEqual({ e164: '+64211234567', country: 'NZ' });
    expect(parseMobile('NZ', '0061 412 345 678')).toEqual({ e164: '+61412345678', country: 'AU' });
    expect(parseMobile('AU', '+44 7700 900123')).toEqual({ e164: '+447700900123', country: 'GB' });
    // A national number from another country without its code isn't guessed at.
    expect(parseMobile('AU', '021 123 4567')).toBeNull();
    expect(parseMobile('AU', '+33 6 12 34 56 78')).toBeNull(); // France: not one of CROP's countries
    expect(parseMobile('AU', 'call 0412')).toBeNull();
    expect(mobileProblem('NZ')).toBe('Mobile is not a mobile number (for example 021 123 4567, or start with + and the country code)');
  });
  it('texts Australian mobiles only for now', () => {
    expect(smsRefusal(parseMobile('AU', '0412 345 678'))).toBeNull();
    expect(smsRefusal(parseMobile('NZ', '021 123 4567'))).toBe('Texts outside Australia are not switched on yet');
    expect(smsRefusal(null)).toBe('Not a mobile number');
  });
  it('finds people by the digits of their mobile', () => {
    expect(phoneSearchDigits('0412 345')).toBe('412345');
    expect(phoneSearchDigits('+61 412')).toBe('61412');
    expect(phoneSearchDigits('041')).toBeNull();
    expect(phoneSearchDigits('Ana 0412')).toBeNull();
    expect(phoneSearchDigits(null)).toBeNull();
  });
  it('escapes HTML in emails and links https addresses', () => {
    expect(textToHtml('<b>Hi</b>\n\nOpen https://staging.cropwms.com/x')).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(textToHtml('Open https://staging.cropwms.com/x')).toContain('<a href="https://staging.cropwms.com/x">');
  });
});

describe('notifications', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const email = new MemoryEmail();
  const sms = new MemorySms();
  let dispatcher: NotificationDispatcher;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await createTestDatabase('crop_notify_api');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cfy','Demo Agency'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [id('cfy'), id('other')]);
    await owner.query(`insert into tenant_settings(tenant_id, sms_monthly_cap) values ($1, 2)`, [id('cfy')]);
    for (const [sub, mail] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email: mail, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER).useValue(email)
      .overrideProvider(SMS_SENDER).useValue(sms)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    dispatcher = app.get(NotificationDispatcher);
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await idp?.close();
    await db?.drop();
  });

  it('sends a test email to the signed-in admin and logs it', async () => {
    await http().post('/notifications/test').set(as('alloc')).send({ channel: 'email' }).expect(403);
    const q = await http().post('/notifications/test').set(as('admin')).send({ channel: 'email' }).expect(201);
    expect(q.body.status).toBe('queued');
    expect(await dispatcher.runOnce()).toBe(1);
    expect(email.sent).toMatchObject([{ to: 'admin@x.com', subject: 'CROP test email' }]);
    expect(email.sent[0].idempotencyKey).toBe(q.body.id);
    const log = await http().get('/notifications').set(as('alloc')).expect(200);
    expect(log.body).toMatchObject({ emailReady: true, smsReady: true, messages: [{ channel: 'email', status: 'sent', to: 'admin@x.com' }] });
  });

  it('sends SMS to Australian mobiles only, within the monthly limit', async () => {
    await http().post('/notifications/test').set(as('admin')).send({ channel: 'sms', to: '02 9876 5432' }).expect(400);
    for (let i = 0; i < 3; i++) await http().post('/notifications/test').set(as('admin')).send({ channel: 'sms', to: '0412 345 678' }).expect(201);
    await dispatcher.runOnce();
    expect(sms.sent).toHaveLength(2);
    expect(sms.sent[0].to).toBe('+61412345678');
    const log = await http().get('/notifications').set(as('admin')).expect(200);
    expect(log.body.smsThisMonth).toBe(2);
    expect(log.body.smsPartsThisMonth).toBe(2);
    expect(log.body.messages.find((m: { channel: string }) => m.channel === 'sms')).toMatchObject({ smsParts: 1, smsUnicode: [] });
    expect(log.body.messages.filter((m: { status: string }) => m.status === 'skipped')).toMatchObject([{ error: 'Monthly SMS limit reached' }]);
  });

  it('retries temporary failures later and gives up on permanent ones', async () => {
    email.failNext = new SendError('email provider said 503', true);
    await http().post('/notifications/test').set(as('admin')).send({ channel: 'email' }).expect(201);
    await dispatcher.runOnce();
    let latest = (await http().get('/notifications').set(as('admin'))).body.messages[0];
    expect(latest).toMatchObject({ status: 'queued', attempts: 1, error: 'email provider said 503' });
    await owner.query(`update notifications set next_attempt_at = now() where status = 'queued'`); // time passes
    await dispatcher.runOnce();
    latest = (await http().get('/notifications').set(as('admin'))).body.messages[0];
    expect(latest).toMatchObject({ status: 'sent', attempts: 2 });

    email.failNext = new SendError('email provider said 422: invalid address', false);
    await http().post('/notifications/test').set(as('admin')).send({ channel: 'email' }).expect(201);
    await dispatcher.runOnce();
    latest = (await http().get('/notifications').set(as('admin'))).body.messages[0];
    expect(latest).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('keeps each agency’s message log private', async () => {
    const other = await http().get('/notifications').set(as('other')).expect(200);
    expect(other.body.messages).toEqual([]);
  });
});
