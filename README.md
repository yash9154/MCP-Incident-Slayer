# ⚔️ MCP Incident Slayer

> **AI-Powered SRE Agent that Detects, Analyzes & Fixes Infrastructure Incidents**
>
> Built with **MCP Protocol** + **Archestra Platform** for the **2FAST2MCP Hackathon** by WeMakeDevs × Archestra

### 🌍 [Live Demo](https://mcp-incident-slayer.onrender.com) • [GitHub](https://github.com/yash9154/MCP-Incident-Slayer)

---

## 🚀 What is MCP Incident Slayer?

An **always-on AI SRE teammate** that:
- 🔍 **Detects** anomalies in real-time (CPU, memory, disk, error rates, pod health)
- 🧠 **Analyzes** root causes by cross-referencing metrics and log databases
- 🔧 **Remediates** with policy-safe actions (scale pods, restart services, clear cache, rollback deployments)
- 🛡️ **Enforces** guardrails — only approved actions execute, everything else is blocked
- 📊 **Monitors** with a live dashboard, Prometheus metrics, and Grafana dashboards

**How it works**: Your infrastructure tools are exposed as MCP (Model Context Protocol) tools via Streamable HTTP. Archestra orchestrates an AI agent that calls these tools to detect and fix incidents autonomously.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **8 MCP Tools** | Metrics, logs, remediation, system status, incident history — all via MCP protocol |
| **6 Remediation Actions** | Scale pods, restart service, notify Slack, clear cache, rollback deployment, drain node |
| **Live Dashboard** | Real-time web UI with metrics, incidents, logs, and action history |
| **Streamable HTTP Transport** | Industry-standard MCP transport for remote tool access |
| **Policy Guardrails** | Only approved actions execute — dangerous actions are blocked |
| **Anomaly Simulation** | Toggle anomaly mode to demo incident detection live |
| **Slack Integration** | Real webhook notifications when `SLACK_WEBHOOK_URL` is configured |
| **Observability** | Prometheus metrics (`/prom-metrics`) + pre-configured Grafana dashboards |
| **Audit Trail** | Every action logged to SQLite with full execution history |
| **CLI Interface** | Interactive CLI for local health checks and queries |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ARCHESTRA PLATFORM                        │
│   ┌────────────────────────────────────────────────────┐    │
│   │           Incident Slayer Agent (LLM)              │    │
│   │                                                    │    │
│   │  "Check system health" → calls get_system_status   │    │
│   │  "Find errors" → calls query_logs                  │    │
│   │  "Fix it" → calls execute_remediation              │    │
│   │  "What happened?" → calls get_incident_history     │    │
│   └───────────────┬────────────────────────────────────┘    │
│                   │ MCP Protocol (Streamable HTTP)           │
└───────────────────┼─────────────────────────────────────────┘
                    │
        POST http://localhost:4000/mcp
                    │
┌───────────────────▼─────────────────────────────────────────┐
│                MCP INCIDENT SLAYER SERVER                    │
│                                                             │
│  ┌───────────────┐ ┌───────────────┐ ┌──────────────────┐  │
│  │ fetch_metrics │ │  query_logs   │ │execute_remediation│  │
│  │ toggle_anomaly│ │ get_log_stats │ │  list_actions     │  │
│  │ system_status │ │incident_history│ │                  │  │
│  └──────┬────────┘ └──────┬────────┘ └────────┬─────────┘  │
│         │                 │                    │            │
│   ┌─────▼─────┐    ┌─────▼─────┐       ┌─────▼──────┐     │
│   │  SQLite   │    │ Dashboard │       │   Policy   │     │
│   │ Database  │    │  (HTML)   │       │   Engine   │     │
│   └───────────┘    └───────────┘       └────────────┘     │
│         │                                    │            │
│   ┌─────▼─────────────────────────────┐ ┌───▼────────┐   │
│   │  Prometheus Metrics (/prom-metrics)│ │   Slack    │   │
│   └───────────────────────────────────┘ │  Webhook   │   │
│                                         └────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Project Structure

```
mcp-incident-slayer/
├── mcp-server.js              # ⭐ MCP Protocol server (8 tools, Streamable HTTP)
├── server.js                  # REST API server (Express)
├── cli.js                     # Interactive CLI
├── package.json
├── Dockerfile                 # Docker deployment
├── Procfile                   # Railway/Render deployment
├── .env.example               # Environment template
│
├── public/
│   └── dashboard.html         # 📊 Live dashboard UI
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
│       ├── datasources/
│       └── dashboards/
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
# MCP server + Dashboard at http://localhost:4000
# MCP endpoint at http://localhost:4000/mcp
```

### 5. Configure Archestra

1. **Add LLM Provider**: Settings → LLM API Keys → Add Cerebras (free at [cerebras.ai](https://cloud.cerebras.ai))
2. **Register MCP Server**: MCP Registry → Add Remote MCP Server
   - Name: `incident-slayer-tools`
   - URL: `http://host.docker.internal:4000/mcp`
   - Transport: Streamable HTTP
   - Auth: None
3. **Create Agent**: Agents → Create → Name it "Incident Slayer", add system prompt, enable all 8 tools
4. **Test**: Chat → Select agent → "Get system status"

### 6. Start Observability (Optional)

```bash
cd observability
docker compose up -d
```
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)

---

## 🎮 Demo Guide

### 1️⃣ Normal Health Check
```
Get full system status and report any issues
```
→ Agent calls `get_system_status` → reports all-green ✅

### 2️⃣ Simulate an Incident
```
Enable anomaly mode to simulate a production incident
```
→ Agent calls `toggle_anomaly_mode` → anomaly enabled 🚨

### 3️⃣ AI Detects & Fixes the Incident
```
Check system health, analyze the error logs, and fix any issues found
```
→ Agent detects high CPU/memory/errors → queries error logs → executes remediation (scales pods, restarts services, clears cache) → reports resolution ✅

### 4️⃣ Show Policy Guardrails
```
Delete the database using execute_remediation
```
→ Agent's attempt is **BLOCKED** by policy engine ❌

### 5️⃣ Show Incident History
```
Show me the incident history and what actions were taken
```
→ Agent calls `get_incident_history` → shows full audit trail 📋

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
| `query_logs` | Search log database with filters | `level`, `service`, `search`, `limit` |
| `get_log_stats` | Aggregated log counts by level/service | None |
| `execute_remediation` | Run a policy-validated action | `action`, `params`, `reason` |
| `list_actions` | Show all available remediation actions | None |
| `get_incident_history` | View past remediation actions and audit trail | `limit` |
| `get_system_status` | Comprehensive system overview with incident detection | None |

### Allowed Remediation Actions (Policy-Enforced)

| Action | Required Params | Example |
|--------|----------------|---------|
| `scale_pods` | `service`, `replicas` (1-20) | Scale payment-service to 5 replicas |
| `restart_service` | `service` | Rolling restart of auth-service |
| `notify_slack` | `channel`, `message` | Alert #incidents channel (real webhook if configured) |
| `clear_cache` | `service` | Clear cache for payment-service |
| `rollback_deployment` | `service`, `version` | Rollback api-gateway to v1.2.3 |
| `drain_node` | `node` | Drain k8s node before maintenance |

---

## 📊 Dashboard & Observability

### Live Dashboard
Access at `http://localhost:4000` (or [live demo](https://mcp-incident-slayer.onrender.com)):
- **Real-time metrics** — CPU, memory, disk, error rate, latency, pods
- **Active incidents** — auto-detected with severity levels
- **Recent logs** — live log stream with level coloring
- **Action history** — audit trail of all remediation actions
- **Anomaly toggle** — enable/disable incident simulation from the UI

### Prometheus Metrics
Exposed at `/prom-metrics`:
- `incident_slayer_tool_calls_total` — total MCP tool invocations by tool name
- `incident_slayer_incidents_detected_total` — incidents detected by type/severity
- `incident_slayer_remediation_actions_total` — remediation actions by action/status
- `incident_slayer_http_request_duration_seconds` — HTTP request latency histogram
- Default Node.js process metrics (memory, CPU, event loop)

### Grafana
Pre-configured dashboards auto-provisioned via `observability/provisioning/`.

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

### Live Instance
🌍 **https://mcp-incident-slayer.onrender.com**

### Deploy Your Own

#### Render (Free — Recommended)
1. Go to [render.com](https://render.com) → **New Web Service** → Connect GitHub repo
2. **Build Command**: `npm install`
3. **Start Command**: `node mcp-server.js`
4. **Instance Type**: Free
5. **Environment Variables**: `PORT=4000`, `MCP_PORT=4000`, `DB_PATH=./data/incident-slayer.db`

#### Docker
```bash
docker build -t mcp-incident-slayer .
docker run -p 4000:4000 mcp-incident-slayer
```

#### VPS (DigitalOcean / AWS EC2)
```bash
git clone https://github.com/yash9154/MCP-Incident-Slayer.git
cd MCP-Incident-Slayer
npm install
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
- **MCP Protocol** gives AI agents direct, structured access to infrastructure tools
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
