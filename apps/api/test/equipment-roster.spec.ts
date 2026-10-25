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

describe('equipment on the roster', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, licenceType: string, forkliftType: string, vehicleType: string;
  let fork1: string, fork2: string, ute: string, ana: string, ben: string;

  const mkShift = async (date: string, startTime: string, endTime: string) =>
    (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Operator', date, startTime, endTime }).expect(201)).body.ids[0] as string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_equipment_api');
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

    site = (await http().post('/facilities').set(as('admin')).send({ name: 'North Yard', state: 'VIC' }).expect(201)).body.id;
    licenceType = (await http().post('/credential-types').set(as('admin')).send({ name: 'Forklift licence', category: 'licence', hasNumber: false, needsEvidence: false }).expect(201)).body.id;
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Operator'] }).expect(201)).body.id;
    ben = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ben', lastName: 'Sample', roles: ['Operator'] }).expect(201)).body.id;
    for (const w of [ana, ben]) {
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    }
    const c = (await http().post(`/workers/${ana}/credentials`).set(as('admin')).send({ credentialTypeId: licenceType, expiryDate: '2030-01-01' }).expect(201)).body.id;
    await http().post(`/workers/${ana}/credentials/${c}/verify`).set(as('admin')).send({}).expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('keeps an equipment register with types and operator credentials', async () => {
    await http().post('/equipment-types').set(as('alloc')).send({ name: 'Forklift' }).expect(403);
    await http().post('/equipment-types').set(as('admin')).send({ name: 'Forklift', operatorCredentialTypeId: 'nope' }).expect(400);
    const ft = await http().post('/equipment-types').set(as('admin')).send({ name: 'Forklift', operatorCredentialTypeId: licenceType }).expect(201);
    forkliftType = ft.body.id;
    expect(ft.body).toMatchObject({ name: 'Forklift', operatorCredentialName: 'Forklift licence', active: true });
    await http().post('/equipment-types').set(as('admin')).send({ name: 'forklift' }).expect(400);
    vehicleType = (await http().post('/equipment-types').set(as('admin')).send({ name: 'Light vehicle' }).expect(201)).body.id;
    expect((await http().get('/equipment-types').set(as('alloc')).expect(200)).body.map((x: { name: string }) => x.name)).toEqual(['Forklift', 'Light vehicle']);

    await http().post('/equipment').set(as('admin')).send({ name: 'Forklift 1' }).expect(400); // no type
    fork1 = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: forkliftType, name: 'Forklift 1', assetNumber: 'FL-01', homeFacilityId: site }).expect(201)).body.id;
    fork2 = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: forkliftType, name: 'Forklift 2', assetNumber: 'FL-02' }).expect(201)).body.id;
    await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: forkliftType, name: 'Forklift 3', assetNumber: 'fl-01' }).expect(400); // asset number taken
    const u = await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: vehicleType, name: 'Ute 1', registration: 'abc123' }).expect(201);
    ute = u.body.id;
    expect(u.body).toMatchObject({ registration: 'ABC123', typeName: 'Light vehicle', status: 'active', checkState: 'ok', checks: [] });

    // Dates that must be current; a new date for the same name replaces the old one and keeps history.
    await http().post(`/equipment/${ute}/checks`).set(as('alloc')).send({ name: 'Registration', dueOn: '2026-11-04' }).expect(403);
    await http().post(`/equipment/${ute}/checks`).set(as('admin')).send({ name: 'Registration', dueOn: '4 Nov' }).expect(400);
    await http().post(`/equipment/${ute}/checks`).set(as('admin')).send({ name: 'Registration', dueOn: '2020-01-01' }).expect(201);
    await http().post(`/equipment/${ute}/checks`).set(as('admin')).send({ name: 'registration', dueOn: '2026-11-04' }).expect(201);
    const d = await http().post(`/equipment/${ute}/checks`).set(as('admin')).send({ name: 'Service', dueOn: '2030-06-01', notes: '10,000 km' }).expect(201);
    expect(d.body.checks.map((x: { name: string; dueOn: string }) => `${x.name} ${x.dueOn}`)).toEqual(['registration 2026-11-04', 'Service 2030-06-01']);
    expect(d.body.history).toMatchObject([{ name: 'Registration', dueOn: '2020-01-01' }]);
    await http().post(`/equipment/${fork1}/checks`).set(as('admin')).send({ name: 'Annual inspection', dueOn: '2030-01-01' }).expect(201);

    const list = await http().get('/equipment').set(as('alloc')).expect(200);
    expect(list.body.map((x: { name: string }) => x.name)).toEqual(['Forklift 1', 'Forklift 2', 'Ute 1']);
    await http().get('/equipment').set(as('worker')).expect(403);
  });

  it('books equipment to shifts with hard blocks and warnings', async () => {
    const mon = await mkShift('2026-11-09', '07:00', '15:00');

    // Nobody on the shift yet: a forklift can be booked, with a warning that it needs an operator.
    const b = await http().post(`/shifts/${mon}/equipment`).set(as('alloc')).send({ equipmentId: fork1 }).expect(200);
    expect(b.body.equipment).toEqual([{ id: fork1, name: 'Forklift 1', typeName: 'Forklift' }]);
    expect(b.body.status).toBe('open'); // status follows the person
    expect(b.body.warnings).toEqual(['Forklift 1 needs an operator holding a Forklift licence; nobody is on this shift yet']);
    await http().post(`/shifts/${mon}/equipment`).set(as('alloc')).send({ equipmentId: fork1 }).expect(409); // already on it

    // Ben has no forklift licence, so he can't go on a shift with a forklift.
    const cands = (await http().get(`/shifts/${mon}/candidates`).set(as('alloc')).expect(200)).body.candidates;
    expect(cands.find((c: { workerId: string }) => c.workerId === ben).blocks.map((x: { code: string }) => x.code)).toEqual(['operator']);
    const no = await http().post(`/shifts/${mon}/assign`).set(as('alloc')).send({ workerId: ben }).expect(409);
    expect(no.body.message).toBe("Ben Sample doesn't hold a current, verified Forklift licence, needed to operate Forklift 1");
    await http().post(`/shifts/${mon}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);

    // The ute's registration is overdue by the shift date.
    const ec = (await http().get(`/shifts/${mon}/equipment-candidates`).set(as('alloc')).expect(200)).body.candidates;
    expect(ec.map((c: { name: string; eligible: boolean }) => `${c.name}:${c.eligible}`)).toEqual(['Forklift 1:true', 'Forklift 2:true', 'Ute 1:false']);
    const r = await http().post(`/shifts/${mon}/equipment`).set(as('alloc')).send({ equipmentId: ute }).expect(409);
    expect(r.body.message).toBe("Ute 1's registration will be overdue by the shift date (due Wed 4 Nov)");
    await http().post(`/equipment/${ute}/checks`).set(as('admin')).send({ name: 'Registration', dueOn: '2027-11-04' }).expect(201);
    await http().post(`/shifts/${mon}/equipment`).set(as('alloc')).send({ equipmentId: ute }).expect(200);

    // Equipment can't be in two places at once.
    const overlap = await mkShift('2026-11-09', '14:00', '20:00');
    const clash = await http().post(`/shifts/${overlap}/equipment`).set(as('alloc')).send({ equipmentId: ute }).expect(409);
    expect(clash.body.message).toMatch(/^Ute 1 is already booked .*07:00–15:00 at North Yard$/);
    await http().post(`/shifts/${overlap}/equipment`).set(as('alloc')).send({ equipmentId: fork2 }).expect(200);

    // With a booked forklift, Ben can't be put on that shift either; once it's removed he can.
    await http().post(`/shifts/${overlap}/assign`).set(as('alloc')).send({ workerId: ben }).expect(409);
    const rm = await http().post(`/shifts/${overlap}/equipment/${fork2}/remove`).set(as('alloc')).expect(200);
    expect(rm.body.equipment).toEqual([]);
    await http().post(`/shifts/${overlap}/equipment/${fork2}/remove`).set(as('alloc')).expect(409);
    await http().post(`/shifts/${overlap}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
    // …and a forklift can't then be booked onto Ben's shift.
    const op = await http().post(`/shifts/${overlap}/equipment`).set(as('alloc')).send({ equipmentId: fork2 }).expect(409);
    expect(op.body.message).toMatch(/Ben Sample doesn't hold a current, verified Forklift licence/);

    // Out of service blocks booking; cancelling a shift frees its equipment.
    await http().patch(`/equipment/${fork2}`).set(as('admin')).send({ status: 'out_of_service' }).expect(200);
    const tue = await mkShift('2026-11-10', '07:00', '15:00');
    const oos = await http().post(`/shifts/${tue}/equipment`).set(as('alloc')).send({ equipmentId: fork2 }).expect(409);
    expect(oos.body.message).toBe('Forklift 2 is out of service');
    await http().post(`/shifts/${overlap}/cancel`).set(as('alloc')).send({ reason: 'Not needed' }).expect(200);
    const late = await mkShift('2026-11-09', '16:00', '20:00');
    await http().post(`/shifts/${late}/equipment`).set(as('alloc')).send({ equipmentId: ute }).expect(200);
    await http().post(`/shifts/${late}/equipment`).set(as('worker')).send({ equipmentId: fork1 }).expect(403);

    // The equipment record lists upcoming bookings.
    const one = await http().get(`/equipment/${ute}`).set(as('alloc')).expect(200);
    const future = Date.now() < Date.parse('2026-11-09T09:00:00Z'); // only shifts that haven't finished count
    expect(one.body.upcomingBookings.map((s: { localStart: string }) => s.localStart)).toEqual(future ? ['07:00', '16:00'] : []);
  });

  it('shows equipment rows with hours on the roster', async () => {
    const roster = await http().get('/roster?from=2026-11-09&to=2026-11-15').set(as('alloc')).expect(200);
    expect(roster.body.equipment).toMatchObject([
      { name: 'Forklift 1', typeName: 'Forklift', bookedHours: 8 },
      { name: 'Forklift 2', status: 'out_of_service', bookedHours: 0 },
      { name: 'Ute 1', typeName: 'Light vehicle', bookedHours: 12 },
    ]);
    const shift = roster.body.shifts.find((s: { localStart: string; localDate: string }) => s.localDate === '2026-11-09' && s.localStart === '07:00');
    expect(shift.equipment.map((e: { name: string }) => e.name)).toEqual(['Forklift 1', 'Ute 1']);
    await http().patch(`/equipment/${fork2}`).set(as('admin')).send({ status: 'retired' }).expect(200);
    expect((await http().get('/roster?from=2026-11-09&to=2026-11-15').set(as('alloc')).expect(200)).body.equipment).toHaveLength(2);
  });

  it('books equipment on its own, without a person (dry hire)', async () => {
    await http().post('/shifts').set(as('alloc')).send({ facilityId: site, date: '2026-11-11', startTime: '07:00', endTime: '17:00' }).expect(400); // role needed for people
    await http().post('/shifts').set(as('alloc')).send({ facilityId: site, equipmentOnly: 'yes', date: '2026-11-11', startTime: '07:00', endTime: '17:00' }).expect(400);
    const c = await http().post('/shifts').set(as('alloc')).send({ facilityId: site, equipmentOnly: true, date: '2026-11-11', startTime: '07:00', endTime: '17:00', notes: 'Dry hire to a client' }).expect(201);
    const id = c.body.ids[0] as string;
    const s = (await http().get(`/shifts/${id}`).set(as('alloc')).expect(200)).body;
    expect(s).toMatchObject({ role: 'Equipment only', equipmentOnly: true, status: 'open', equipment: [] });

    // The client supplies the operator, so a forklift needs no licence holder from us and the shift is booked.
    const b = await http().post(`/shifts/${id}/equipment`).set(as('alloc')).send({ equipmentId: fork1 }).expect(200);
    expect(b.body).toMatchObject({ status: 'booked', equipmentOnly: true, warnings: [] });
    expect(b.body.equipment.map((e: { name: string }) => e.name)).toEqual(['Forklift 1']);

    // Nobody can be put on it.
    expect((await http().get(`/shifts/${id}/candidates`).set(as('alloc')).expect(200)).body.candidates).toEqual([]);
    const no = await http().post(`/shifts/${id}/assign`).set(as('alloc')).send({ workerId: ana }).expect(409);
    expect(no.body.message).toBe('This shift is for equipment only, so nobody can be put on it');

    // Still one place at once: the forklift can't also go on an overlapping ordinary shift.
    const other = await mkShift('2026-11-11', '12:00', '18:00');
    await http().post(`/shifts/${other}/equipment`).set(as('alloc')).send({ equipmentId: fork1 }).expect(409);

    // A second item keeps it booked; removing everything opens it again.
    await http().post(`/shifts/${id}/equipment`).set(as('alloc')).send({ equipmentId: ute }).expect(200);
    expect((await http().post(`/shifts/${id}/equipment/${fork1}/remove`).set(as('alloc')).expect(200)).body.status).toBe('booked');
    expect((await http().post(`/shifts/${id}/equipment/${ute}/remove`).set(as('alloc')).expect(200)).body.status).toBe('open');
    await http().post(`/shifts/${id}/equipment/${ute}/remove`).set(as('other')).expect(404);

    // Ordinary shifts are unchanged.
    expect((await http().get(`/shifts/${other}`).set(as('alloc')).expect(200)).body.equipmentOnly).toBe(false);
  });

  it('keeps each business\'s equipment separate', async () => {
    expect((await http().get('/equipment').set(as('other')).expect(200)).body).toEqual([]);
    expect((await http().get('/equipment-types').set(as('other')).expect(200)).body).toEqual([]);
    await http().get(`/equipment/${ute}`).set(as('other')).expect(404);
    await http().post(`/equipment/${ute}/checks`).set(as('other')).send({ name: 'Service', dueOn: '2030-01-01' }).expect(404);
    await http().post('/equipment').set(as('other')).send({ equipmentTypeId: forkliftType, name: 'Stolen' }).expect(400);
    const theirSite = (await http().post('/facilities').set(as('other')).send({ name: 'Other Yard', state: 'NSW' }).expect(201)).body.id;
    const theirShift = (await http().post('/shifts').set(as('other')).send({ facilityId: theirSite, role: 'Operator', date: '2026-11-09', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${theirShift}/equipment`).set(as('other')).send({ equipmentId: fork1 }).expect(400);
  });
});
