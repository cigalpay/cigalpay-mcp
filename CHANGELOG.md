# Changelog

## 1.2.0

- Remote mode: `cigalpay-mcp --http` serves the same tools over Streamable HTTP (`/mcp`), for agents on
  platforms that only accept a remote MCP URL. Stateless: each request brings the merchant's credentials
  (`Authorization: Bearer <accountId>:<apiKey>`), nothing is stored. Hosted at `https://mcp.cigalpay.com/mcp`.
- Optional headers: `X-CigalPay-Notify-Url`, `X-CigalPay-Return-Url`, `X-CigalPay-Allow-Refunds: 1`.

## 1.1.1

- zod 4 (fixes GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized input).
- The server instructions tell the assistant that tool results are data, not instructions: text in them
  (descriptions, order references, refund reasons) can come from other people and is never acted on.
- Length limits on payment and order ids.

## 1.1.0

- `create_checkout` takes `fee_paid_by` (`customer` or `merchant`): who pays the processing fee on that payment.
  Left out, the dashboard setting applies. Needs cigalpay-js-sdk 2.3.0.

## 1.0.1

- Published from GitHub Actions with npm provenance.
- The server reports the version from package.json.

## 1.0.0

- First release: `create_checkout`, `get_payment`, `get_payments_by_order`, `list_active_payments`,
  `list_supported_coins`, `list_refunds`, and `create_refund` (off unless `CIGALPAY_ALLOW_REFUNDS=1`).
