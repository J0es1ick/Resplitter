import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeCallback, encodeCallback } from '../src/utils/callback-data';

test('callback payload stays compact and round-trips', () => {
  const sessionId = 'abcdEFGHijklMNOPqrst12';
  const encoded = encodeCallback(sessionId, 'removeItem', 'abc123');
  assert.ok(Buffer.byteLength(encoded) <= 64);
  assert.deepEqual(decodeCallback(encoded), { sessionId, action: 'removeItem', value: 'abc123' });
  assert.equal(decodeCallback('invalid'), undefined);
});
