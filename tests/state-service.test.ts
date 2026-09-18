import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ParsedReceipt } from '../src/interfaces';
import { StateService } from '../src/services/state-service';
import type { Update } from 'node-telegram-bot-api';

const receipt: ParsedReceipt = {
  receiptNumber: '1',
  date: '03.08.2026',
  time: '12:00',
  waiter: '',
  currency: 'RUB',
  items: [{ id: 'item-1', name: 'Чай', quantity: 1, unitPriceMinor: 10000, lineTotalMinor: 10000, confidence: 1 }],
  subtotalMinor: 10000,
  totalMinor: 10000,
  confidence: 1,
  warnings: []
};

test('state service isolates owner mutations and participant selections', async () => {
  const service = new StateService(undefined, 60_000);
  await service.initialize();
  try {
    const session = await service.createSession(10, -100, receipt);
    assert.match(session.id, /^[A-Za-z0-9_-]{20,24}$/);
    await assert.rejects(
      service.updateSession(session.id, (draft) => void (draft.receipt.totalMinor = 1), { actorUserId: 11, ownerOnly: true }),
      /SESSION_FORBIDDEN/
    );
    await assert.rejects(service.join(session.id, 11, 'Участник'), /RECEIPT_NOT_CONFIRMED/);
    await service.updateSession(session.id, (s) => {
      s.status = 'open';
    });
    await service.join(session.id, 11, 'Участник');
    const selected = await service.toggleSelection(session.id, 11, 'Участник', 'item-1');
    assert.deepEqual(selected.participants['11']?.itemIds, ['item-1']);
    const deselected = await service.toggleSelection(session.id, 11, 'Участник', 'item-1');
    assert.deepEqual(deselected.participants['11']?.itemIds, []);
  } finally {
    await service.close();
  }
});

test('state service persists and reloads sessions', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'resplitter-state-'));
  const stateFile = path.join(directory, 'state.sqlite');
  try {
    const first = new StateService(stateFile, 60_000);
    await first.initialize();
    const created = await first.createSession(10, -100, receipt);
    first.setBotUi(-100, 10, { messageId: 123, catalog: { section: 'closed', page: 2 }, receipt: { sessionId: created.id, mode: 'app' } });
    await first.updateSession(created.id, (draft) => void (draft.receipt.totalMinor = 12345), { actorUserId: 10, ownerOnly: true });
    await first.updateSession(created.id, (draft) => {
      draft.status = 'open';
    });
    const joined = await first.join(created.id, 10, 'Автор');
    await first.saveSelection(created.id, 10, 'Автор', ['item-1'], joined.version, { 'item-1': 0.5 });
    first.enqueue({ update_id: 123 } as Update);
    assert.equal(first.nextUpdate()?.id, 123);
    await first.close();

    const second = new StateService(stateFile, 60_000);
    await second.initialize();
    assert.deepEqual(second.getBotUi(-100, 10), {
      messageId: 123,
      catalog: { section: 'closed', page: 2 },
      receipt: { sessionId: created.id, mode: 'app' }
    });
    assert.equal(second.botUiOwner(-100, 123), 10);
    assert.deepEqual(second.getBotUi(-100, 11), {});
    assert.equal(second.getSession(created.id)?.receipt.totalMinor, 12345);
    assert.deepEqual(second.getSession(created.id)?.participants['10'].itemQuantities, { 'item-1': 0.5 });
    assert.equal(second.nextUpdate()?.id, 123);
    second.finishUpdate(123);
    second.enqueue({ update_id: 123 } as Update);
    assert.equal(second.nextUpdate(), undefined);
    await second.close();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('failed mutations roll back and do not poison later writes; stale writers lose CAS', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    const s = await store.createSession(1, 1, receipt, 'same-source');
    assert.equal((await store.createSession(1, 1, receipt, 'same-source')).id, s.id);
    await assert.rejects(
      store.updateSession(s.id, (d) => {
        d.receipt.subtotalMinor++;
      })
    );
    assert.equal(store.getSession(s.id)?.version, 1);
    const results = await Promise.allSettled([
      store.updateSession(
        s.id,
        (d) => {
          d.status = 'open';
        },
        { expectedVersion: 1 }
      ),
      store.updateSession(
        s.id,
        (d) => {
          d.status = 'open';
        },
        { expectedVersion: 1 }
      )
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    await store.join(s.id, 1, 'Owner');
    const ready = store.getSession(s.id)!;
    await assert.rejects(store.finalize(s.id, 1, ready.version), /UNASSIGNED_ITEMS/);
    const selected = await store.saveSelection(s.id, 1, 'Owner', ['item-1'], ready.version);
    await store.finalize(s.id, 1, selected.version);
    await assert.rejects(
      store.updateSession(s.id, () => {}),
      /SESSION_FINALIZED/
    );
  } finally {
    await store.close();
  }
});
