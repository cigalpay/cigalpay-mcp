// CigalPay MCP server: the tools an AI assistant can use on a CigalPay account.
// Credentials come from the environment and never appear in tool results.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CigalPay } from 'cigalpay-js-sdk';

export const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const DEFAULT_RETURN_URL = 'https://cigalpay.com/';

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

/** Runs one API call and turns errors into a readable tool error, without secrets. */
async function call(fn) {
    try {
        return ok(await fn());
    } catch (err) {
        const status = err?.status ? ` (HTTP ${err.status})` : '';
        return fail(`${err?.message || String(err)}${status}`);
    }
}

/**
 * @param {Record<string, string | undefined>} env  Usually process.env
 */
export function createServer(env = process.env) {
    const accountId = env.CIGALPAY_ACCOUNT_ID;
    const apiKey = env.CIGALPAY_API_KEY;
    const allowRefunds = env.CIGALPAY_ALLOW_REFUNDS === '1' || env.CIGALPAY_ALLOW_REFUNDS === 'true';
    const cigalpay = new CigalPay({
        accountId,
        apiKey,
        checkoutUrl: env.CIGALPAY_CHECKOUT_URL,
        apiUrl: env.CIGALPAY_API_URL,
        merchantApiUrl: env.CIGALPAY_MERCHANT_API_URL,
    });

    const server = new McpServer(
        { name: 'cigalpay', version: VERSION },
        {
            instructions:
                'CigalPay is a crypto payment gateway. Prices are in USD or EUR; the customer picks the coin ' +
                '(Bitcoin, USDT, Ethereum, Solana...) on the checkout page. Use create_checkout to get a payment link, ' +
                'then get_payment or get_payments_by_order to follow it. A payment is paid only when its status is ' +
                'confirmed or finished. Refunds move money: always confirm the payment and amount with the user first.',
        },
    );

    const needsKey = () => (apiKey ? null : fail('Set CIGALPAY_API_KEY (dashboard > Settings > API credentials) to use this tool.'));

    server.registerTool(
        'create_checkout',
        {
            title: 'Create a crypto payment link',
            description:
                'Create a payment priced in USD or EUR and return the CigalPay checkout link to send to the customer. ' +
                'The customer chooses the coin on the checkout page; the rate is locked for 30 minutes. Maximum 5,000 per payment.',
            inputSchema: {
                amount: z.number().positive().max(5000).describe('Price in the currency, e.g. 49.9'),
                currency: z.enum(['USD', 'EUR']),
                description: z.string().min(1).max(200).describe('Shown to the customer, e.g. "Logo design - invoice 1042"'),
                order_id: z.string().min(1).max(100).optional().describe('Your reference for this payment (generated if omitted)'),
                return_url: z.string().url().optional().describe('Where the customer goes after paying'),
                notify_url: z.string().url().optional().describe('Public HTTPS URL that receives signed payment notifications'),
                lang: z.enum(['en', 'fr', 'es', 'de']).optional().describe('Checkout language (default en)'),
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        async (a) => {
            if (!accountId) return fail('Set CIGALPAY_ACCOUNT_ID (dashboard > Settings > API credentials) to create payment links.');
            const notifyUrl = a.notify_url || env.CIGALPAY_NOTIFY_URL;
            if (!notifyUrl) {
                return fail('Pass notify_url, or set CIGALPAY_NOTIFY_URL: a public HTTPS URL that receives the signed payment notifications.');
            }
            const orderId = a.order_id || `mcp-${randomUUID().slice(0, 8)}`;
            return call(async () => {
                const res = await cigalpay.createCheckout({
                    amount: a.amount,
                    currency: a.currency,
                    description: a.description,
                    orderId,
                    returnUrl: a.return_url || env.CIGALPAY_RETURN_URL || DEFAULT_RETURN_URL,
                    notifyUrl,
                    lang: a.lang,
                });
                return { checkout_id: res.id, link: res.chargeLink, order_id: orderId, amount: a.amount, currency: a.currency };
            });
        },
    );

    server.registerTool(
        'get_payment',
        {
            title: 'Get a payment',
            description: 'Status, coin, amounts and transaction of a payment by its id. Paid means status confirmed or finished.',
            inputSchema: { payment_id: z.string().min(1) },
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async ({ payment_id }) => needsKey() || call(() => cigalpay.getPayment(payment_id)),
    );

    server.registerTool(
        'get_payments_by_order',
        {
            title: 'Find the payments of an order',
            description: 'Every payment created for one of your order references (the order_id of create_checkout).',
            inputSchema: { order_id: z.string().min(1) },
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async ({ order_id }) => needsKey() || call(() => cigalpay.getPaymentsByOrder(order_id)),
    );

    server.registerTool(
        'list_active_payments',
        {
            title: 'List payments waiting for funds',
            description: 'Payments created on the account that are still waiting for the customer to pay.',
            inputSchema: {},
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async () => needsKey() || call(() => cigalpay.getActivePayments()),
    );

    server.registerTool(
        'list_supported_coins',
        {
            title: 'List accepted coins',
            description: 'The coins CigalPay accepts directly (other coins are converted automatically at checkout).',
            inputSchema: {},
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async () => call(() => cigalpay.getSupportedCoins()),
    );

    server.registerTool(
        'list_refunds',
        {
            title: 'List the refunds of a payment',
            description: 'Refunds of a payment, newest first, with their status.',
            inputSchema: { payment_id: z.string().min(1) },
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async ({ payment_id }) => needsKey() || call(() => cigalpay.getRefunds(payment_id)),
    );

    if (allowRefunds) {
        server.registerTool(
            'create_refund',
            {
                title: 'Refund a payment',
                description:
                    'Refund a paid payment in crypto. Moves money out of the CigalPay balance: confirm the payment and the amount ' +
                    'with the user before calling. Give either amount (in the coin paid) or checkout_amount (in the USD/EUR of the checkout). ' +
                    'The customer receives a link to enter the address to refund.',
                inputSchema: {
                    payment_id: z.string().min(1),
                    amount: z.number().positive().optional().describe('In the coin paid'),
                    checkout_amount: z.number().positive().optional().describe('In the checkout currency (USD or EUR)'),
                    customer_email: z.string().email().optional().describe('Gets the link to enter their refund address'),
                    reason: z.string().max(500).optional(),
                },
                annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
            },
            async (a) => {
                if ((a.amount === undefined) === (a.checkout_amount === undefined)) {
                    return fail('Give exactly one of amount or checkout_amount.');
                }
                return (
                    needsKey() ||
                    call(() =>
                        cigalpay.createRefund({
                            paymentId: a.payment_id,
                            amount: a.amount,
                            checkoutAmount: a.checkout_amount,
                            customerEmail: a.customer_email,
                            reason: a.reason,
                        }),
                    )
                );
            },
        );
    }

    return server;
}
