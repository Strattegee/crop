import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrate, setAppRolePassword } from '@crop/db';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';

const OWNER_URL = process.env.DATABASE_URL ?? 'postgres://crop:crop@localhost:5432/crop';
const dbName = `crop_api_test_${Date.now()}`;
const withDb = (url: string, db: string, user?: [string, string]) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) [u.username, u.password] = user;
  return u.toString();
};

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('CROP API', () => {
  let app: INestApplication;
  const admin = new Client({ connectionString: OWNER_URL });

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const owner = withDb(OWNER_URL, dbName);
    await migrate(owner, () => undefined);
    await setAppRolePassword(owner, 'api-test-pw');
    const c = new Client({ connectionString: owner });
    await c.connect();
    await c.query(`insert into tenants(id, slug, name) values ($1,'cfy-demo','Demo Agency'),($2,'other','Other Agency')`, [randomUUID(), randomUUID()]);
    await c.end();
    process.env.APP_DATABASE_URL = withDb(OWNER_URL, dbName, ['crop_app', 'api-test-pw']);
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  it('reports health', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('requires a tenant', async () => {
    await request(app.getHttpServer()).get('/facilities').expect(401);
  });

  it('keeps facilities separate per tenant', async () => {
    await request(app.getHttpServer()).post('/facilities').set('x-tenant', 'cfy-demo')
      .send({ name: 'Ward 3 North' }).expect(201);
    const mine = await request(app.getHttpServer()).get('/facilities').set('x-tenant', 'cfy-demo').expect(200);
    expect(mine.body.map((f: { name: string }) => f.name)).toEqual(['Ward 3 North']);
    const theirs = await request(app.getHttpServer()).get('/facilities').set('x-tenant', 'other').expect(200);
    expect(theirs.body).toEqual([]);
  });

  it('rejects an invalid time zone', async () => {
    await request(app.getHttpServer()).post('/facilities').set('x-tenant', 'cfy-demo')
      .send({ name: 'X', timezone: 'Mars/Olympus' }).expect(400);
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/health', '/facilities']));
  });
});
