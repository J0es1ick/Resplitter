import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { clientAddress } from '../src/http/client-address';

function request(remoteAddress: string, headers: IncomingHttpHeaders): IncomingMessage {
  return { socket: { remoteAddress }, headers } as IncomingMessage;
}

test('walks trusted X-Forwarded-For proxies from right to left and ignores Forwarded', () => {
  const trusted = ['127.0.0.1', '10.0.0.1'];
  const req = request('::ffff:127.0.0.1', {
    'x-forwarded-for': '198.51.100.99, 203.0.113.5, 10.0.0.1',
    forwarded: 'for=198.51.100.88'
  });
  assert.equal(clientAddress(req, trusted), '203.0.113.5');
  assert.equal(clientAddress(req, ['127.0.0.1']), '10.0.0.1');
  assert.equal(clientAddress(req), '127.0.0.1');
  assert.equal(clientAddress(request('127.0.0.1', { forwarded: 'for=198.51.100.88' }), trusted), '127.0.0.1');
});

test('canonicalizes IP representations and fails closed on a malformed trusted hop', () => {
  assert.equal(clientAddress(request('::ffff:7f00:1', { 'x-forwarded-for': '::ffff:c000:201' }), ['127.0.0.1']), '192.0.2.1');
  assert.equal(clientAddress(request('::1', { 'x-forwarded-for': '2001:0db8:0:0:0:0:0:1' }), ['0:0:0:0:0:0:0:1']), '2001:db8::1');
  assert.equal(clientAddress(request('127.0.0.1', { 'x-forwarded-for': '203.0.113.5, invalid' }), ['127.0.0.1']), '127.0.0.1');
});
