// Remote mode: the same CigalPay tools over Streamable HTTP, for AI agents hosted
// on platforms that only accept a remote MCP server URL.
//
// Stateless: every request carries the merchant's own credentials and gets a fresh
// server; nothing is stored. Credentials come from headers:
//
//   Authorization: Bearer <accountId>:<apiKey>     (one token, works with any client)
//   or Authorization: Bearer <apiKey>  +  X-CigalPay-Account-Id: <accountId>
//   X-CigalPay-Notify-Url: https://...   (optional, default notification URL)
//   X-CigalPay-Return-Url: https://...   (optional)
//   X-CigalPay-Allow-Refunds: 1          (optional, enables create_refund)
//
// The API base URLs come from this server's own environment, never from a request.

import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per-IP request limit (in memory: one process). */
function rateLimiter(max, windowMs) {
    const hits = new Map();
    return (key) => {
        const now = Date.now();
        if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
        const hit = hits.get(key);
        if (!hit || hit.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return true;
        }
        hit.count += 1;
        return hit.count <= max;
    };
}

const header = (req, name) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** The merchant's credentials and options from the request headers, or null without a token. */
export function credentialsFrom(req) {
    const auth = header(req, 'authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) return null;
    let token = m[1].trim();
    let accountId = header(req, 'x-cigalpay-account-id');
    const sep = token.indexOf(':');
    if (sep > 0 && UUID.test(token.slice(0, sep))) {
        accountId = token.slice(0, sep);
        token = token.slice(sep + 1);
    }
    if (!token || token.length > 512 || (accountId && !UUID.test(accountId))) return null;
    const refunds = header(req, 'x-cigalpay-allow-refunds');
    return {
        CIGALPAY_ACCOUNT_ID: accountId,
        CIGALPAY_API_KEY: token,
        CIGALPAY_NOTIFY_URL: header(req, 'x-cigalpay-notify-url'),
        CIGALPAY_RETURN_URL: header(req, 'x-cigalpay-return-url'),
        CIGALPAY_ALLOW_REFUNDS: refunds === '1' || refunds === 'true' ? '1' : undefined,
    };
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('too large'), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            try {
                resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined);
            } catch {
                reject(Object.assign(new Error('invalid json'), { status: 400 }));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, body, extraHeaders = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
    res.end(JSON.stringify(body));
}

const rpcError = (message, code = -32000) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

/**
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]  Server environment (API base URLs, limits)
 * @param {(msg: string) => void} [options.log]
 */
export function createHttpServer({ env = process.env, log = (msg) => console.error(msg) } = {}) {
    // Only the API base URLs are taken from the server's environment.
    const base = {
        CIGALPAY_CHECKOUT_URL: env.CIGALPAY_CHECKOUT_URL,
        CIGALPAY_API_URL: env.CIGALPAY_API_URL,
        CIGALPAY_MERCHANT_API_URL: env.CIGALPAY_MERCHANT_API_URL,
    };
    const allow = rateLimiter(Number(env.MCP_RATE_LIMIT_PER_MINUTE) || 120, 60_000);
    // Behind Cloudflare (tunnel), the visitor's address is in CF-Connecting-IP.
    const ipOf = (req) => header(req, 'cf-connecting-ip') ?? req.socket.remoteAddress ?? 'unknown';

    return http.createServer(async (req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/health' && req.method === 'GET') return sendJson(res, 200, { status: 'ok' });
        if (path !== MCP_PATH) return sendJson(res, 404, { error: 'Not found. The MCP endpoint is /mcp.' });

        // Stateless server: no sessions to resume (GET) or close (DELETE).
        if (req.method !== 'POST') return sendJson(res, 405, rpcError('Method not allowed.'), { Allow: 'POST' });

        if (!allow(ipOf(req))) return sendJson(res, 429, rpcError('Too many requests. Try again in a minute.'));

        const creds = credentialsFrom(req);
        if (!creds) {
            return sendJson(res, 401, rpcError('Send your CigalPay credentials: Authorization: Bearer <accountId>:<apiKey> (dashboard > Settings > API credentials).'), {
                'WWW-Authenticate': 'Bearer realm="cigalpay-mcp"',
            });
        }

        let body;
        try {
            body = await readBody(req);
        } catch (err) {
            return sendJson(res, err.status ?? 400, rpcError(err.status === 413 ? 'Request too large.' : 'Invalid JSON.', -32700));
        }

        const server = createServer({ ...base, ...creds });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => {
            transport.close().catch(() => {});
            server.close().catch(() => {});
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        } catch (err) {
            // Never log headers or bodies: they hold the merchant's API key.
            log(`[mcp-http] request failed: ${err?.message ?? err}`);
            if (!res.headersSent) sendJson(res, 500, rpcError('Server error.', -32603));
        }
    });
}

/** Starts the remote server on PORT (default 8080). */
export function startHttpServer(env = process.env) {
    const port = Number(env.PORT) || 8080;
    const host = env.HOST || '0.0.0.0';
    const server = createHttpServer({ env });
    server.listen(port, host, () => console.error(`CigalPay MCP server (Streamable HTTP) on http://${host}:${port}${MCP_PATH}`));
    return server;
}
