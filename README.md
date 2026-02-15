# ⚔️ MCP Incident Slayer

> **AI-Powered SRE Agent that Detects, Analyzes & Fixes Infrastructure Incidents**
>
> Built with **MCP Protocol** + **Archestra Platform** for the **2FAST2MCP Hackathon** by WeMakeDevs × Archestra

---

## 🚀 What is MCP Incident Slayer?

An **always-on AI SRE teammate** that:
- 🔍 **Detects** anomalies in real-time (CPU, memory, disk, error rates, pod health)
- 🧠 **Analyzes** root causes by cross-referencing metrics and log databases
- 🔧 **Remediates** with policy-safe actions (scale pods, restart services, notify Slack)
- 🛡️ **Enforces** guardrails — only approved actions execute, everything else is blocked

**How it works**: Your infrastructure tools are exposed as MCP (Model Context Protocol) tools via Streamable HTTP. Archestra orchestrates an AI agent that calls these tools to detect and fix incidents autonomously.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **6 MCP Tools** | Metrics, logs, remediation, anomaly simulation — all via MCP protocol |
| **Streamable HTTP Transport** | Industry-standard MCP transport for remote tool access |
| **Policy Guardrails** | Only `scale_pods`, `restart_service`, `notify_slack` allowed |
| **Anomaly Simulation** | Toggle anomaly mode to demo incident detection live |
| **Audit Trail** | Every action logged to SQLite with execution history |
| **Observability** | Prometheus metrics + Grafana dashboards (optional) |
| **CLI Interface** | Interactive CLI for local health checks and queries |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ARCHESTRA PLATFORM                        │
│   ┌────────────────────────────────────────────────────┐    │
│   │           Incident Slayer Agent (LLM)              │    │
│   │                                                    │    │
│   │  "Check system health" → calls fetch_metrics       │    │
│   │  "Find errors" → calls query_logs                  │    │
│   │  "Fix it" → calls execute_remediation              │    │
│   └───────────────┬────────────────────────────────────┘    │
│                   │ MCP Protocol (Streamable HTTP)           │
└───────────────────┼─────────────────────────────────────────┘
                    │
        POST http://localhost:4000/mcp
                    │
┌───────────────────▼─────────────────────────────────────────┐
│                MCP INCIDENT SLAYER SERVER                    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │fetch_metrics │  │ query_logs   │  │execute_remediation│  │
│  │toggle_anomaly│  │ get_log_stats│  │ list_actions      │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         └────────────┬────┴──────────┬─────────┘            │
│                      │               │                      │
│               ┌──────▼──────┐  ┌─────▼──────┐              │
│               │   SQLite    │  │   Policy   │              │
│               │  Database   │  │   Engine   │              │
│               └─────────────┘  └────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Project Structure

```
mcp-incident-slayer/
├── mcp-server.js              # ⭐ MCP Protocol server (Streamable HTTP)
├── server.js                  # REST API server (Express)
├── cli.js                     # Interactive CLI
├── package.json
├── .env.example               # Environment template
│
├── lib/
│   └── database.js            # SQLite wrapper (sql.js)
│
├── tools/                     # REST tool implementations
│   ├── metrics-fetcher.js     # Infrastructure metrics
│   ├── logs-db.js             # Log database queries
│   └── remediation-executor.js # Safe action execution
│
├── agents/                    # Agent system prompts
│   ├── detector_prompt.txt
│   ├── analyzer_prompt.txt
│   ├── remediator_prompt.txt
│   └── observer_prompt.txt
│
├── tests/                     # Test suites
│   ├── metrics.test.js
│   ├── logs.test.js
│   └── remediation.test.js
│
├── observability/             # Prometheus + Grafana configs
│   ├── docker-compose.yml
│   ├── prometheus.yml
│   └── provisioning/
│
└── docs/
    ├── README.md              # Detailed documentation
    ├── architecture.md        # Architecture deep-dive
    └── diagram.mmd            # Mermaid diagram
```

---

## 🛠️ Setup & Installation

### Prerequisites

- **Node.js** 18+
- **Docker** (for Archestra platform)
- **npm** 9+

### 1. Clone & Install

```bash
git clone https://github.com/yash9154/MCP-Incident-Slayer.git
cd MCP-Incident-Slayer
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Default config works out of the box — no API keys needed for the MCP server!
```

### 3. Start Archestra Platform

```bash
docker pull archestra/platform:latest
docker run -p 9000:9000 -p 3000:3000 \
  -e ARCHESTRA_QUICKSTART=true \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v archestra-postgres-data:/var/lib/postgresql/data \
  -v archestra-app-data:/app/data \
  archestra/platform
```

- **Chat UI**: http://localhost:3000
- **Admin**: http://localhost:9000

### 4. Start MCP Server

```bash
npm run mcp
# MCP server starts at http://localhost:4000/mcp
```

### 5. Configure Archestra

1. **Add LLM Provider**: Settings → LLM API Keys → Add Cerebras (free at [cerebras.ai](https://cloud.cerebras.ai))
2. **Register MCP Server**: MCP Registry → Add Remote MCP Server
   - Name: `incident-slayer-tools`
   - URL: `http://host.docker.internal:4000/mcp`
   - Auth: None
3. **Create Agent**: Agents → Create → Name it "Incident Slayer", add system prompt, enable all 6 tools
4. **Test**: Chat → Select agent → "Check system health"

---

## 🎮 Demo Guide

### Normal Health Check
In Archestra Chat, ask:
```
Check system health and report any incidents
```
→ Agent calls `fetch_metrics` → reports all-green ✅

### Simulate an Incident
```
Enable anomaly mode, then check system health and fix any issues
```
→ Agent enables anomaly → detects high CPU/memory/errors 🚨 → queries error logs → executes remediation (scales pods, restarts service) → reports resolution ✅

### Show Policy Enforcement
```
Try to delete the database using execute_remediation
```
→ Agent's attempt is **blocked** by policy engine ❌

### CLI (Local Testing)
```bash
node cli.js --local                    # Health check
node cli.js --anomaly on               # Enable anomaly mode
node cli.js --anomaly off              # Disable anomaly mode
```

---

## 🔧 MCP Tools Reference

| Tool | Description | Parameters |
|------|-------------|------------|
| `fetch_metrics` | Get CPU, memory, disk, network, error rate, pod status | None |
| `toggle_anomaly_mode` | Enable/disable incident simulation | `enabled` (boolean) |
| `query_logs` | Search log database | `level`, `service`, `search`, `limit` |
| `get_log_stats` | Aggregated log counts by level/service | None |
| `execute_remediation` | Run a policy-validated action | `action`, `params`, `reason` |
| `list_actions` | Show available remediation actions | None |

### Allowed Remediation Actions

| Action | Required Params | Example |
|--------|----------------|---------|
| `scale_pods` | `service`, `replicas` (1-20) | Scale payment-service to 5 replicas |
| `restart_service` | `service` | Restart auth-service |
| `notify_slack` | `channel`, `message` | Alert #incidents channel |

---

## 🧪 Testing

```bash
npm test
```

Tests cover:
- ✅ Metrics — response shape, value ranges, anomaly mode
- ✅ Logs — querying, filtering, insertion, stats
- ✅ Remediation — allowed/rejected actions, validation, audit trail

---

## 🚀 Deployment

### Option 1: Railway (Recommended — Free Tier)

1. Push to GitHub:
   ```bash
   git add -A
   git commit -m "Deploy MCP Incident Slayer"
   git push origin main
   ```

2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**

3. Select your repo → Railway auto-detects Node.js

4. Set environment variables:
   ```
   PORT=4000
   MCP_PORT=4000
   DB_PATH=./data/incident-slayer.db
   ```

5. Railway gives you a URL like `https://mcp-incident-slayer.up.railway.app`

6. Update Archestra MCP Registry URL to:
   ```
   https://mcp-incident-slayer.up.railway.app/mcp
   ```

### Option 2: Render (Free Tier)

1. Go to [render.com](https://render.com) → **New Web Service** → Connect GitHub repo
2. **Build Command**: `npm install`
3. **Start Command**: `node mcp-server.js`
4. **Environment**: Add same vars as above
5. Use the Render URL in Archestra MCP Registry

### Option 3: Docker

```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 4000
CMD ["node", "mcp-server.js"]
```

```bash
docker build -t mcp-incident-slayer .
docker run -p 4000:4000 mcp-incident-slayer
```

### Option 4: VPS (DigitalOcean / AWS EC2)

```bash
# SSH into your server
git clone https://github.com/yash9154/MCP-Incident-Slayer.git
cd MCP-Incident-Slayer
npm install
# Use PM2 for production process management
npm install -g pm2
pm2 start mcp-server.js --name incident-slayer
pm2 save
```

---

## 🏆 Hackathon Pitch

### The Problem
SRE teams face **alert fatigue** — when incidents happen at 3 AM, response time is critical but humans are slow, tired, and make mistakes under pressure.

### Our Solution
**MCP Incident Slayer** is an AI SRE agent that:
1. **Never sleeps** — continuous monitoring with sub-second detection
2. **Never panics** — follows strict policy guardrails
3. **Never forgets** — full audit trail of every action
4. **Escalates wisely** — knows when to act and when to call a human

### Why MCP + Archestra?
- **MCP tools** give AI agents direct, structured access to infrastructure
- **Archestra orchestration** chains specialized agents with built-in guardrails
- **Streamable HTTP transport** enables remote tool access from anywhere

### Impact
- **MTTR reduction**: From 30+ minutes to under 60 seconds
- **Alert fatigue reduction**: AI triages, humans decide
- **Zero false remediations**: Policy engine prevents dangerous actions

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — See [LICENSE](LICENSE) for details.

---

**Built with ❤️ for the 2FAST2MCP Hackathon by WeMakeDevs × Archestra**
