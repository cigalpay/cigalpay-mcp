# CigalPay MCP server

<!-- mcp-name: io.github.cigalpay/cigalpay-mcp -->

Let Claude, Cursor, VS Code and other AI assistants use your [CigalPay](https://cigalpay.com) account: create crypto
payment links, check whether a payment arrived, and follow refunds, by asking in plain language.

> "Create a 49 EUR payment link for invoice 1042, logo design."
> "Has the payment for order 1042 been confirmed?"

Prices are in USD or EUR. Your customer picks the coin on the CigalPay checkout (Bitcoin, USDT on Tron, Ethereum,
Solana, Litecoin and more), with the rate locked for 30 minutes.

## Tools

| Tool | What it does |
|---|---|
| `create_checkout` | Create a payment priced in USD or EUR and return the checkout link (up to 5,000 per payment). `fee_paid_by: customer` adds the processing fee to the customer's price |
| `get_payment` | Status, coin and amounts of a payment. Paid means `confirmed` or `finished` |
| `get_payments_by_order` | Every payment created for one of your order references |
| `list_active_payments` | Payments still waiting for the customer |
| `list_supported_coins` | Coins accepted directly |
| `list_refunds` | Refunds of a payment and their status |
| `create_refund` | Refund a payment in crypto. **Off by default**: set `CIGALPAY_ALLOW_REFUNDS=1` |

`create_refund` moves money out of your CigalPay balance, so it is only available when you turn it on, and it is
marked as destructive so your assistant asks before using it.

## Setup

Get your **Account ID** and **API key** in the [CigalPay dashboard](https://merchant.cigalpay.com), Settings → API
credentials. Node.js 18 or later is needed.

| Variable | |
|---|---|
| `CIGALPAY_ACCOUNT_ID` | Required to create payment links |
| `CIGALPAY_API_KEY` | Required to read payments and refunds. Keep it secret |
| `CIGALPAY_NOTIFY_URL` | Public HTTPS URL that receives signed payment notifications. Needed by `create_checkout`, unless you pass `notify_url` each time |
| `CIGALPAY_RETURN_URL` | Where customers go after paying (default: cigalpay.com) |
| `CIGALPAY_ALLOW_REFUNDS` | `1` to enable `create_refund` |

### Claude Code

```bash
claude mcp add cigalpay \
  -e CIGALPAY_ACCOUNT_ID=your-account-id \
  -e CIGALPAY_API_KEY=your-api-key \
  -e CIGALPAY_NOTIFY_URL=https://your-site.com/cigalpay/notify \
  -- npx -y cigalpay-mcp
```

### Claude Desktop, Cursor, VS Code and others

Add to the client's MCP configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, ...):

```json
{
  "mcpServers": {
    "cigalpay": {
      "command": "npx",
      "args": ["-y", "cigalpay-mcp"],
      "env": {
        "CIGALPAY_ACCOUNT_ID": "your-account-id",
        "CIGALPAY_API_KEY": "your-api-key",
        "CIGALPAY_NOTIFY_URL": "https://your-site.com/cigalpay/notify"
      }
    }
  }
}
```

## Payment notifications

CigalPay sends a signed notification to your notify URL when a payment's status changes. Check the
`x-cigalpay-sig` signature before trusting it, with the [JavaScript SDK](https://www.npmjs.com/package/cigalpay-js-sdk)
(`CigalPay.verifyWebhook`) or the [PHP SDK](https://packagist.org/packages/cigalpay/cigalpay-php-sdk). See the
[developer docs](https://cigalpay.com/developers).

## Release

Bump the version in `package.json`, `server.json` (twice) and `CHANGELOG.md`, then push a tag `vX.Y.Z`. GitHub
Actions stages the package on npm; approve it on npmjs.com, then run the **MCP Registry** workflow.

## License

[MIT](LICENSE)
