import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { startFakeIdp } from './fake-idp.js';

describe('items and consumables API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let north: string, south: string, ana: string, shift: string, gloves: string, diesel: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_items_api');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('yard','Demo Yard'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [id('yard'), id('other')]);
    await owner.end();
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    north = (await http().post('/facilities').set(as('admin')).send({ name: 'North Yard', state: 'VIC' }).expect(201)).body.id;
    south = (await http().post('/facilities').set(as('admin')).send({ name: 'South Yard', state: 'VIC' }).expect(201)).body.id;
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Operator'] }).expect(201)).body.id;
    shift = (await http().post('/shifts').set(as('alloc')).send({ facilityId: north, role: 'Operator', date: '2026-11-10', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('keeps a catalogue of items', async () => {
    await http().post('/items').set(as('alloc')).send({ name: 'Safety gloves' }).expect(403);
    await http().post('/items').set(as('admin')).send({ name: 'Safety gloves', category: 'food' }).expect(400);
    await http().post('/items').set(as('admin')).send({ name: 'Safety gloves', unitCostCents: 4.5 }).expect(400);
    const g = await http().post('/items').set(as('admin')).send({ name: 'Safety gloves', category: 'ppe', unit: 'pair', unitCostCents: 450, reorderLevel: 5 }).expect(201);
    gloves = g.body.id;
    expect(g.body).toMatchObject({ name: 'Safety gloves', category: 'ppe', unit: 'pair', unitCostCents: 450, chargeCents: null, tracksStock: true, reorderLevel: 5, onHand: 0, sites: [], movements: [] });
    await http().post('/items').set(as('admin')).send({ name: 'safety gloves' }).expect(400);
    const d = await http().post('/items').set(as('admin')).send({ name: 'Diesel', category: 'fuel', unit: 'litre', unitCostCents: 199, chargeCents: 250, tracksStock: false }).expect(201);
    diesel = d.body.id;
    const list = await http().get('/items').set(as('alloc')).expect(200);
    expect(list.body.map((i: { name: string }) => i.name)).toEqual(['Diesel', 'Safety gloves']);
    await http().get('/items').set(as('worker')).expect(403);
  });

  it('receives, issues, uses, returns and counts stock per site', async () => {
    await http().post(`/items/${gloves}/receive`).set(as('alloc')).send({ facilityId: north, quantity: 0 }).expect(400);
    await http().post(`/items/${gloves}/receive`).set(as('alloc')).send({ facilityId: north, quantity: 1.0001 }).expect(400);
    await http().post(`/items/${gloves}/receive`).set(as('alloc')).send({ quantity: 10 }).expect(400);
    let r = await http().post(`/items/${gloves}/receive`).set(as('alloc')).send({ facilityId: north, quantity: 10, unitCostCents: 500 }).expect(201);
    expect(r.body).toMatchObject({ onHand: 10, unitCostCents: 500, sites: [{ facilityName: 'North Yard', onHand: 10, low: false }] });
    await http().post(`/items/${diesel}/receive`).set(as('alloc')).send({ facilityId: north, quantity: 100 }).expect(400); // not counted

    // Issue to a person for a shift; use on a shift; stock comes from the shift's site.
    await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 2 }).expect(400);
    await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 2, workerId: ana }).expect(400); // which site?
    r = await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 2, workerId: ana, shiftId: shift }).expect(201);
    expect(r.body.movements[0]).toMatchObject({ kind: 'issued', quantity: -2, workerName: 'Ana Example', shiftId: shift, facilityName: 'North Yard', unitCostCents: 500 });
    r = await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 3, shiftId: shift }).expect(201);
    expect(r.body.movements[0]).toMatchObject({ kind: 'used', quantity: -3 });
    const short = await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 6, shiftId: shift }).expect(409);
    expect(short.body.message).toBe('Only 5 × Safety gloves (pair) on hand at North Yard');
    await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 1, workerId: ana, facilityId: south }).expect(409);
    r = await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 1, workerId: ana, facilityId: north }).expect(201);
    expect(r.body.sites).toEqual([{ facilityId: north, facilityName: 'North Yard', onHand: 4, low: true }]);

    // Fuel isn't counted: use is recorded without a stock check, charged to the client.
    await http().post(`/items/${diesel}/issue`).set(as('alloc')).send({ quantity: 40.5, shiftId: shift }).expect(201);

    // Returns: no more than went out.
    const tooMany = await http().post(`/items/${gloves}/return`).set(as('alloc')).send({ quantity: 4, workerId: ana }).expect(409);
    expect(tooMany.body.message).toBe('Only 3 Safety gloves are out with Ana Example');
    await http().post(`/items/${gloves}/return`).set(as('alloc')).send({ quantity: 1, workerId: ana, shiftId: shift }).expect(201);
    await http().post(`/items/${gloves}/return`).set(as('alloc')).send({ quantity: 4, shiftId: shift }).expect(409);
    r = await http().post(`/items/${gloves}/return`).set(as('alloc')).send({ quantity: 1, shiftId: shift }).expect(201);
    expect(r.body.onHand).toBe(6);

    // Stocktake: only owners and admins; records the difference.
    await http().post(`/items/${gloves}/count`).set(as('alloc')).send({ facilityId: north, quantity: 5 }).expect(403);
    r = await http().post(`/items/${gloves}/count`).set(as('admin')).send({ facilityId: north, quantity: 5, notes: 'Monthly count' }).expect(201);
    expect(r.body.movements[0]).toMatchObject({ kind: 'adjusted', quantity: -1, notes: 'Monthly count' });
    r = await http().post(`/items/${gloves}/count`).set(as('admin')).send({ facilityId: north, quantity: 5 }).expect(201);
    expect(r.body.movements.filter((m: { kind: string }) => m.kind === 'adjusted')).toHaveLength(1);

    const stock = await http().get('/stock').set(as('alloc')).expect(200);
    expect(stock.body).toEqual([{ itemId: gloves, name: 'Safety gloves', category: 'ppe', unit: 'pair', facilityId: north, facilityName: 'North Yard', onHand: 5, reorderLevel: 5, low: true }]);
    expect((await http().get(`/stock?facilityId=${south}`).set(as('alloc')).expect(200)).body).toEqual([]);
  });

  it('shows what a shift used and what a person holds, at the prices recorded', async () => {
    // A price change applies from now on, not to what was already used.
    await http().patch(`/items/${gloves}`).set(as('admin')).send({ unitCostCents: 900, chargeCents: 1200 }).expect(200);
    const s = await http().get(`/shifts/${shift}/items`).set(as('alloc')).expect(200);
    expect(s.body).toEqual({
      lines: [
        { itemId: diesel, name: 'Diesel', unit: 'litre', quantity: 40.5, costCents: 8060, chargeCents: 10125 },
        { itemId: gloves, name: 'Safety gloves', unit: 'pair', quantity: 3, costCents: 1500, chargeCents: null },
      ],
      totalCostCents: 9560, totalChargeCents: 10125,
    });
    const w = await http().get(`/workers/${ana}/items`).set(as('alloc')).expect(200);
    expect(w.body.lines).toEqual([{ itemId: gloves, name: 'Safety gloves', unit: 'pair', quantity: 2, costCents: 1000, chargeCents: null }]);
    await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 1, shiftId: shift }).expect(201);
    expect((await http().get(`/shifts/${shift}/items`).set(as('alloc')).expect(200)).body.lines[1]).toMatchObject({ quantity: 4, costCents: 2400, chargeCents: 1200 });
  });

  it('refuses use on a cancelled shift and issues of retired items', async () => {
    const other = (await http().post('/shifts').set(as('alloc')).send({ facilityId: north, role: 'Operator', date: '2026-11-11', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${other}/cancel`).set(as('alloc')).send({ reason: 'Rain' }).expect(200);
    expect((await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ quantity: 1, shiftId: other }).expect(409)).body.message).toBe('This shift is cancelled');
    await http().patch(`/items/${diesel}`).set(as('admin')).send({ active: false }).expect(200);
    await http().post(`/items/${diesel}/issue`).set(as('alloc')).send({ quantity: 1, shiftId: shift }).expect(409);
    expect((await http().get('/items').set(as('alloc')).expect(200)).body.map((i: { name: string }) => i.name)).toEqual(['Safety gloves']);
    expect((await http().get('/items?all=true').set(as('alloc')).expect(200)).body).toHaveLength(2);
  });

  it('keeps the movement history append-only', async () => {
    const appDb = new Client({ connectionString: db.appUrl });
    await appDb.connect();
    try {
      await expect(appDb.query('update stock_movements set quantity = 1')).rejects.toThrow(/permission denied/);
      await expect(appDb.query('delete from stock_movements')).rejects.toThrow(/permission denied/);
    } finally {
      await appDb.end();
    }
  });

  it('keeps each business\'s items separate', async () => {
    expect((await http().get('/items').set(as('other')).expect(200)).body).toEqual([]);
    expect((await http().get('/stock').set(as('other')).expect(200)).body).toEqual([]);
    await http().get(`/items/${gloves}`).set(as('other')).expect(404);
    await http().post(`/items/${gloves}/issue`).set(as('other')).send({ quantity: 1, shiftId: shift }).expect(404);
    await http().get(`/shifts/${shift}/items`).set(as('other')).expect(404);
    await http().get(`/workers/${ana}/items`).set(as('other')).expect(404);
    const theirs = (await http().post('/items').set(as('other')).send({ name: 'Safety gloves' }).expect(201)).body.id;
    await http().post(`/items/${theirs}/receive`).set(as('other')).send({ facilityId: north, quantity: 1 }).expect(400); // not their site
  });
});
