import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createHttpHandler } from '../src/http/app';
import type { SessionView } from '../src/http/app';
import { StateService } from '../src/services/state-service';
import { demoReceipt } from '../src/domain/demo';
import { initData, testToken } from './helpers';
import { ReceiptReviewService } from '../src/services/receipt-review-service';

test('HTTP integration: authenticated ownership, concurrency, sharing and idempotent finalization', async () => {
  const store = new StateService();
  await store.initialize();
  let memberStatus = 'member';
  const handler = createHttpHandler({
    store,
    token: testToken,
    botUsername: () => 'test_bot',
    lookup: async () => ({ status: memberStatus }),
    miniAppUrl: 'https://test.example',
    webDir: path.resolve('dist/web'),
    webhookEnabled: true,
    webhookSecret: 'test-secret',
    ready: () => true,
    metrics: () => 'metric 1',
    metricsToken: 'metrics-secret'
  });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  async function request(url: string, id = 1, payload?: unknown) {
    return fetch(base + url, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { authorization: 'tma ' + initData(id), 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
  }
  try {
    const created = await store.createSession(1, 1, demoReceipt());
    const route = '/api/sessions/' + created.id;
    assert.equal((await fetch(base + route)).status, 401);
    assert.equal((await request(route, 2)).status, 403);
    assert.equal((await fetch(base + '/metrics')).status, 404);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/health/ready')).status, 200);
    assert.equal((await request(route)).status, 409);
    for (const action of ['join', 'confirm', 'receipt', 'share', 'selection', 'mode', 'finalize']) {
      assert.equal((await request(route + '/' + action, 1, { version: created.version })).status, 409);
    }
    assert.equal(((await (await request('/api/sessions')).json()) as { sessions: unknown[] }).sessions.length, 0);
    await new ReceiptReviewService(store).confirm(created.id, 1, created.version);
    let s = (await (await request(route + '/join', 1, {})).json()) as SessionView;
    assert.match(s.reviewUrl, /\?start=review_/);
    assert.equal((await request(route + '/confirm', 1, { version: s.version })).status, 404);
    const old = s.version;
    s = (await (
      await request(route + '/selection', 1, { version: s.version, itemIds: s.receipt.items.map((i) => i.id) })
    ).json()) as SessionView;
    assert.equal((await request(route + '/selection', 1, { version: old, itemIds: [] })).status, 409);
    assert.equal((await request(route + '/selection', 1, { version: s.version, itemIds: ['not-real'] })).status, 422);
    const invalid = structuredClone(s.receipt);
    invalid.subtotalMinor++;
    assert.equal((await request(route + '/receipt', 1, { version: s.version, receipt: invalid })).status, 404);
    const invitation = (await (await request(route + '/share', 1, { version: s.version })).json()) as { url: string; session: SessionView };
    assert.match(invitation.url, /https:\/\/t.me\/test_bot\?start=join_/);
    assert.equal('inviteToken' in invitation.session, false);
    s = invitation.session;
    assert.equal((await request(route + '/finalize', 1, { version: s.version })).status, 200);
    assert.equal((await request(route + '/finalize', 1, { version: s.version })).status, 200);
    const notice = store.nextNotification();
    assert.ok(notice);
    store.notificationAttempt(notice.id, true);
    assert.equal(store.nextNotification(), undefined);
    assert.equal((await request(route + '/mode', 1, { version: s.version, mode: 'equal' })).status, 409);
    const group = await store.createSession(1, -100, demoReceipt());
    await new ReceiptReviewService(store).confirm(group.id, 1, group.version);
    assert.equal((await request('/api/sessions/' + group.id, 2)).status, 200);
    await request('/api/sessions/' + group.id + '/join', 2, {});
    assert.ok(
      ((await (await request('/api/sessions', 2)).json()) as { sessions: { id: string }[] }).sessions.some((s) => s.id === group.id)
    );
    memberStatus = 'left';
    assert.equal((await request('/api/sessions/' + group.id, 2)).status, 403);
    assert.ok(
      !((await (await request('/api/sessions', 2)).json()) as { sessions: { id: string }[] }).sessions.some((s) => s.id === group.id)
    );
    memberStatus = 'member';
    const beer = demoReceipt();
    beer.items = [{ id: 'beer', name: 'Пиво', quantity: 3, unitPriceMinor: 30000, lineTotalMinor: 90000 }];
    beer.subtotalMinor = beer.totalMinor = 90000;
    let table = await store.createSession(1, -200, beer);
    table = await new ReceiptReviewService(store).confirm(table.id, 1, table.version);
    const tableRoute = '/api/sessions/' + table.id;
    const joined = await Promise.all([1, 2, 3].map((user) => request(tableRoute + '/join', user, {})));
    assert.ok(joined.every((response) => response.status === 200));
    table = store.getSession(table.id)!;
    const competing = await Promise.all([
      request(tableRoute + '/selection', 1, { version: table.version, itemIds: ['beer'], itemQuantities: { beer: 2 } }),
      request(tableRoute + '/selection', 2, { version: table.version, itemIds: ['beer'], itemQuantities: { beer: 1 } })
    ]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    const loser = competing[0].status === 409 ? 1 : 2;
    table = store.getSession(table.id)!;
    const saved = await request(tableRoute + '/selection', loser, {
      version: table.version,
      itemIds: ['beer'],
      itemQuantities: { beer: loser === 1 ? 2 : 1 }
    });
    assert.equal(saved.status, 200);
    const allocated = (await saved.json()) as SessionView;
    assert.deepEqual(allocated.settlement.itemShares.beer, { '1': 60000, '2': 30000 });
    assert.equal(
      (await request(tableRoute + '/selection', 3, { version: allocated.version, itemIds: ['beer'], itemQuantities: { beer: 1 } })).status,
      409
    );
    for (const amount of [0, -1, 0.0001, '1', null]) {
      assert.equal(
        (await request(tableRoute + '/selection', 3, { version: allocated.version, itemIds: ['beer'], itemQuantities: { beer: amount } }))
          .status,
        422
      );
    }
    assert.equal(
      (await request(tableRoute + '/selection', 3, { version: allocated.version, itemIds: ['beer'], itemQuantities: { unknown: 1 } }))
        .status,
      422
    );
    assert.equal((await request(tableRoute + '/selection', 3, { version: allocated.version, userId: 1, itemIds: [] })).status, 422);
    assert.equal((await request(tableRoute + '/finalize', 2, { version: allocated.version })).status, 403);
    assert.equal((await request(tableRoute + '/finalize', 1, { version: allocated.version })).status, 200);
    assert.equal(
      (await fetch(base + route, { headers: { authorization: 'tma ' + initData(1), origin: 'https://evil.invalid' } })).status,
      403
    );
    const update = { update_id: 77, message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 1, text: '/app' } };
    assert.equal(
      (
        await fetch(base + '/telegram/webhook', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(update)
        })
      ).status,
      401
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await fetch(base + '/telegram/webhook', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret' },
            body: JSON.stringify(update)
          })
        ).status,
        200
      );
    assert.equal(store.nextUpdate()?.id, 77);
    assert.equal(store.nextUpdate(), undefined);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await store.close();
  }
});
