import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';

const KEY = 'test-api-key-should-never-leak';
let requests;
let reply;
const realFetch = globalThis.fetch;

beforeEach(() => {
    requests = [];
    reply = () => ({ status: 200, body: {} });
    globalThis.fetch = async (url, init = {}) => {
        requests.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
        const { status, body } = reply(String(url));
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    };
});
afterEach(() => {
    globalThis.fetch = realFetch;
});

async function connect(env) {
    const server = createServer(env);
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
}

const text = (res) => res.content[0].text;
const ENV = { CIGALPAY_ACCOUNT_ID: 'acc_1', CIGALPAY_API_KEY: KEY, CIGALPAY_NOTIFY_URL: 'https://shop.example/ipn' };

test('lists read tools and hides refunds unless allowed', async () => {
    const names = (await (await connect(ENV)).listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['create_checkout', 'get_payment', 'get_payments_by_order', 'list_active_payments', 'list_refunds', 'list_supported_coins']);
    const withRefunds = (await (await connect({ ...ENV, CIGALPAY_ALLOW_REFUNDS: '1' })).listTools()).tools;
    const refund = withRefunds.find((t) => t.name === 'create_refund');
    assert.ok(refund);
    assert.equal(refund.annotations.destructiveHint, true);
});

test('create_checkout sends the pre-invoice and returns the link', async () => {
    reply = () => ({ status: 201, body: { id: 'chk_9', chargeLink: 'https://pay.cigalpay.com/charge/chk_9' } });
    const client = await connect(ENV);
    const res = await client.callTool({ name: 'create_checkout', arguments: { amount: 49.9, currency: 'EUR', description: 'Logo', order_id: 'inv-1042', lang: 'fr' } });
    assert.equal(res.isError, undefined);
    const data = JSON.parse(text(res));
    assert.equal(data.link, 'https://pay.cigalpay.com/charge/chk_9');
    assert.equal(data.order_id, 'inv-1042');
    const sent = requests[0];
    assert.match(sent.url, /\/api\/pre-invoice$/);
    assert.deepEqual(sent.body, {
        accountId: 'acc_1', amount: 49.9, currency: 'EUR', description: 'Logo', extraId: 'inv-1042', lang: 'fr',
        callback: 'https://cigalpay.com/', ipn: 'https://shop.example/ipn',
    });
});

test('create_checkout generates an order id and needs a notify URL', async () => {
    reply = () => ({ status: 201, body: { id: 'x', chargeLink: 'https://l' } });
    const data = JSON.parse(text(await (await connect(ENV)).callTool({ name: 'create_checkout', arguments: { amount: 5, currency: 'USD', description: 'd' } })));
    assert.match(data.order_id, /^mcp-[0-9a-f]{8}$/);

    const { CIGALPAY_NOTIFY_URL, ...noNotify } = ENV;
    const res = await (await connect(noNotify)).callTool({ name: 'create_checkout', arguments: { amount: 5, currency: 'USD', description: 'd' } });
    assert.equal(res.isError, true);
    assert.match(text(res), /notify_url/);
});

test('create_checkout rejects amounts over the limit before any request', async () => {
    const res = await (await connect(ENV)).callTool({ name: 'create_checkout', arguments: { amount: 6000, currency: 'USD', description: 'd' } });
    assert.equal(res.isError, true);
    assert.equal(requests.length, 0);
});

test('get_payment sends the API key header and returns the payment', async () => {
    reply = () => ({ status: 200, body: { id: 'p1', status: 'finished' } });
    const res = await (await connect(ENV)).callTool({ name: 'get_payment', arguments: { payment_id: 'p1' } });
    assert.equal(JSON.parse(text(res)).status, 'finished');
    assert.equal(requests[0].headers['cigalpay-api-key'], KEY);
    assert.match(requests[0].url, /getPaymentStatus\?id=p1$/);
});

test('API errors become tool errors without the key', async () => {
    reply = () => ({ status: 401, body: { error: 'Invalid API key' } });
    const res = await (await connect(ENV)).callTool({ name: 'list_active_payments', arguments: {} });
    assert.equal(res.isError, true);
    assert.match(text(res), /Invalid API key.*401/);
    assert.ok(!text(res).includes(KEY));
});

test('tools that need the key say so when it is missing', async () => {
    const res = await (await connect({ CIGALPAY_ACCOUNT_ID: 'acc_1' })).callTool({ name: 'get_payment', arguments: { payment_id: 'p1' } });
    assert.equal(res.isError, true);
    assert.match(text(res), /CIGALPAY_API_KEY/);
    assert.equal(requests.length, 0);
});

test('create_refund needs exactly one amount and posts the refund', async () => {
    const client = await connect({ ...ENV, CIGALPAY_ALLOW_REFUNDS: '1' });
    const bad = await client.callTool({ name: 'create_refund', arguments: { payment_id: 'p1' } });
    assert.equal(bad.isError, true);
    assert.equal(requests.length, 0);

    reply = () => ({ status: 201, body: { refund: { id: 'r1' }, link: 'https://pay.cigalpay.com/refund/r1' } });
    const res = await client.callTool({ name: 'create_refund', arguments: { payment_id: 'p1', checkout_amount: 10, reason: 'cancelled' } });
    assert.equal(JSON.parse(text(res)).refund.id, 'r1');
    assert.match(requests[0].url, /\/api\/refunds$/);
    assert.deepEqual(requests[0].body, { paymentId: 'p1', checkoutAmount: 10, reason: 'cancelled' });
});
