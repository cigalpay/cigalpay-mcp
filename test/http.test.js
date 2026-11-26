import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../http.js';

const ACCOUNT = '3f1c2b7e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const KEY = 'test-api-key-should-never-leak';
let api; // fake CigalPay API
let apiRequests = [];
let mcp;
let mcpUrl;
const logs = [];

before(async () => {
    api = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            apiRequests.push({ url: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : undefined });
            res.writeHead(req.url.endsWith('/api/pre-invoice') ? 201 : 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(req.url.endsWith('/api/pre-invoice') ? { id: 'chk_1', chargeLink: 'https://pay.cigalpay.com/charge/chk_1' } : []));
        });
    });
    await new Promise((r) => api.listen(0, '127.0.0.1', r));
    const apiUrl = `http://127.0.0.1:${api.address().port}`;
    mcp = createHttpServer({
        env: { CIGALPAY_CHECKOUT_URL: apiUrl, CIGALPAY_API_URL: apiUrl, CIGALPAY_MERCHANT_API_URL: apiUrl, MCP_RATE_LIMIT_PER_MINUTE: '1000' },
        log: (m) => logs.push(m),
    });
    await new Promise((r) => mcp.listen(0, '127.0.0.1', r));
    mcpUrl = `http://127.0.0.1:${mcp.address().port}/mcp`;
});
after(() => {
    api.close();
    mcp.close();
});

async function connect(headers) {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } }));
    return client;
}

test('refuses requests without credentials', async () => {
    const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /Bearer/);
});

test('GET and other paths are refused', async () => {
    assert.equal((await fetch(mcpUrl)).status, 405);
    assert.equal((await fetch(mcpUrl.replace('/mcp', '/other'), { method: 'POST' })).status, 404);
    assert.equal((await fetch(mcpUrl.replace('/mcp', '/health'))).status, 200);
});

test('one token "accountId:apiKey" creates a checkout with the merchant credentials', async () => {
    apiRequests = [];
    const client = await connect({ Authorization: `Bearer ${ACCOUNT}:${KEY}`, 'X-CigalPay-Notify-Url': 'https://shop.example/ipn' });
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('create_checkout'));
    assert.ok(!names.includes('create_refund'), 'refunds stay off by default');
    const res = await client.callTool({ name: 'create_checkout', arguments: { amount: 20, currency: 'USD', description: 'Agent test' } });
    assert.equal(res.isError, undefined);
    assert.equal(JSON.parse(res.content[0].text).link, 'https://pay.cigalpay.com/charge/chk_1');
    const sent = apiRequests.find((r) => r.url.endsWith('/api/pre-invoice'));
    assert.equal(sent.body.accountId, ACCOUNT);
    assert.equal(sent.body.ipn, 'https://shop.example/ipn');
    await client.close();
});

test('API key in the bearer, account id in its own header; refunds on by header', async () => {
    apiRequests = [];
    const client = await connect({ Authorization: `Bearer ${KEY}`, 'X-CigalPay-Account-Id': ACCOUNT, 'X-CigalPay-Allow-Refunds': '1' });
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('create_refund'));
    await client.callTool({ name: 'list_active_payments', arguments: {} });
    const sent = apiRequests.at(-1);
    assert.ok(JSON.stringify(sent.headers).includes(KEY), 'the merchant key is sent to the API');
    await client.close();
});

test('the API key never appears in logs or tool results', async () => {
    const client = await connect({ Authorization: `Bearer ${ACCOUNT}:${KEY}` });
    const res = await client.callTool({ name: 'create_checkout', arguments: { amount: 5, currency: 'EUR', description: 'x' } });
    assert.equal(res.isError, true); // no notify URL given
    assert.ok(!JSON.stringify(res).includes(KEY));
    assert.ok(!logs.join('\n').includes(KEY));
    await client.close();
});
