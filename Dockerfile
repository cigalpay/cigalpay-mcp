# Runs the CigalPay MCP server over stdio. Credentials are passed at run time:
#   docker run -i --rm -e CIGALPAY_ACCOUNT_ID -e CIGALPAY_API_KEY -e CIGALPAY_NOTIFY_URL cigalpay-mcp
# Remote server (Streamable HTTP on port 8080, credentials sent by each client):
#   docker run -d -p 8080:8080 cigalpay-mcp --http
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY index.js server.js http.js ./
USER node
ENTRYPOINT ["node", "index.js"]
