FROM node:18-alpine

WORKDIR /app

# Install dependencies first (cache layer)
COPY package*.json ./
RUN npm ci --production

# Copy app files
COPY . .

# Create data directory for SQLite
RUN mkdir -p data

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "mcp-server.js"]
