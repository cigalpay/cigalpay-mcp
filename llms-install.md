# Installing the CigalPay MCP server (instructions for AI agents)

The server is published on npm as `cigalpay-mcp` and runs over stdio with `npx`. Nothing needs to be cloned or built.

## 1. Ask the user for their credentials

Ask the user for these values. They find them in the CigalPay dashboard (https://merchant.cigalpay.com),
Settings → API credentials. Never invent them, and never print the API key back in full.

| Variable | Required | What to ask |
|---|---|---|
| `CIGALPAY_ACCOUNT_ID` | yes | "Your CigalPay Account ID" |
| `CIGALPAY_API_KEY` | yes | "Your CigalPay API key" |
| `CIGALPAY_NOTIFY_URL` | recommended | "A public HTTPS URL on your site that should receive payment notifications". If the user has none, leave it out: they can pass `notify_url` when creating each payment link. |

Do not set `CIGALPAY_ALLOW_REFUNDS` unless the user explicitly asks to enable refunds: that tool moves money.

## 2. Add the server to the MCP settings

Add this entry to the `mcpServers` object of the MCP settings file (for Cline: `cline_mcp_settings.json`),
keeping any servers already there:

```json
{
  "mcpServers": {
    "cigalpay": {
      "command": "npx",
      "args": ["-y", "cigalpay-mcp"],
      "env": {
        "CIGALPAY_ACCOUNT_ID": "<account id>",
        "CIGALPAY_API_KEY": "<api key>",
        "CIGALPAY_NOTIFY_URL": "<notify url>"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Remove the `CIGALPAY_NOTIFY_URL` line if the user gave none. Node.js 18 or later must be installed.

## 3. Check it works

Call the `list_supported_coins` tool. It should return the list of coins (Bitcoin, USDT on Tron, Ethereum, ...).
Then the user can ask, for example: "Create a 49 EUR payment link for invoice 1042, logo design."
