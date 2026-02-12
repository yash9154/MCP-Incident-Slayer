# Architecture — MCP Incident Slayer

## System Overview

MCP Incident Slayer uses a **multi-agent pipeline** orchestrated by Archestra, where each agent has a specialized role in the incident response lifecycle.

---

## Agent Flow

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  🔍 Detector │ ──→ │ 🧠 Analyzer  │ ──→ │ 🔧 Remediator │ ──→ │ 👁️ Observer   │
│             │     │             │     │              │     │              │
│ Fetch       │     │ Query logs  │     │ Execute safe │     │ Review OTEL  │
│ metrics     │     │ Search GH   │     │ actions      │     │ traces       │
│ Detect      │     │ Correlate   │     │ Enforce      │     │ Suggest      │
│ anomalies   │     │ root cause  │     │ policies     │     │ optimizations│
└─────────────┘     └─────────────┘     └──────────────┘     └──────────────┘
      │                    │                   │                     │
    [MCP]                [MCP]               [MCP]               [OTEL]
      │                    │                   │                     │
  metrics-            logs-db           remediation-          Prometheus
  fetcher                               executor              + Grafana
```

### 1. Detector Agent
- **Input**: Infrastructure metrics from `metrics-fetcher` tool
- **Thresholds**: CPU >80%, Disk >90%, Memory >85%, Pods < desired
- **Output**: JSON with detected incidents, severity scores (1–10)
- **LLM**: Ollama (fast, low-cost local model)

### 2. Analyzer Agent
- **Input**: Detector's incident output
- **Data Sources**: Logs via `logs-db`, GitHub Issues for prior incidents
- **Analysis**: Step-by-step root cause correlation
- **Output**: JSON with cause, confidence (1–10), timeline, blast radius
- **LLM**: OpenAI GPT-4o or Anthropic Claude (high accuracy needed)

### 3. Remediator Agent
- **Input**: Analyzer's root cause output
- **Policy Engine**: Validates actions against allowlist
- **Decision Tree**: Based on confidence level:
  - ≥7: Auto-execute
  - 4–6: Execute with `needs_approval: true`
  - <4: Escalate to GitHub Issue
- **Output**: JSON with action taken, parameters, results
- **LLM**: Ollama (simple decision tree)

### 4. Observer Agent
- **Input**: OTEL traces from the entire pipeline execution
- **Analysis**: Latency, cost, error rate, redundant calls
- **Thresholds**: Total >10s, step >5s, cost >$0.10
- **Output**: Optimization suggestions (cheaper LLM, prompt tuning, caching)
- **LLM**: Ollama (meta-analysis, low stakes)

---

## MCP Tools

All tools are implemented as **Express.js routers** mounted on a single server, backed by **SQLite** (sql.js WASM) for persistence.

### metrics-fetcher
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/metrics` | GET | Current infrastructure snapshot |
| `/metrics/history` | GET | Historical data points |
| `/metrics/anomaly` | POST | Toggle anomaly simulation |

**Key design**: Anomaly mode lets us demo incident detection without a real production environment. Metrics include CPU, disk, memory, pods, network, requests, errors, and latency — all with realistic jitter.

### logs-db
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/logs` | GET | Query with filters (level, service, search) |
| `/logs` | POST | Insert new log entry |
| `/logs/stats` | GET | Aggregate statistics |

**Key design**: Auto-seeds 17 realistic log entries simulating a production incident timeline — from normal operations through warning signs to critical failures and recovery. SQLite with file-backed persistence via sql.js.

### remediation-executor
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/execute` | POST | Execute a policy-validated action |
| `/history` | GET | Audit trail of all executions |
| `/actions` | GET | List available actions with schemas |

**Key design**: Strict allowlist enforcement. Only `scale_pods`, `restart_service`, and `notify_slack` are permitted. All other actions are rejected with 403 and logged as `rejected` in the audit trail. Full parameter validation with typed constraints.

---

## Policies & Guardrails

```
┌────────────────────────────────────────────────────────────┐
│                     POLICY ENGINE                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ALLOWED ACTIONS:                                          │
│    ✅ scale_pods       — replicas: 1–20                    │
│    ✅ restart_service  — rolling restart only               │
│    ✅ notify_slack     — channel + message                  │
│                                                            │
│  BLOCKED ACTIONS:                                          │
│    ❌ delete_*         — any deletion                       │
│    ❌ reboot_*         — any reboot                         │
│    ❌ terminate_*      — any termination                    │
│    ❌ modify_database  — schema/data changes                │
│    ❌ network_*        — network config changes             │
│                                                            │
│  CONFIDENCE ROUTING:                                       │
│    ≥ 7  → Auto-execute                                     │
│    4–6  → Execute with needs_approval flag                 │
│    < 4  → Escalate to GitHub + Slack only                  │
│                                                            │
│  AUDIT:                                                    │
│    All actions logged to SQLite with full context           │
│    Rejected actions also logged for compliance              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## Observability

### Stack
- **Prometheus** scrapes the Express server's `/prom-metrics` endpoint
- **Grafana** auto-provisioned with dashboard on first boot
- **prom-client** exports Node.js and custom application metrics

### Metrics Collected
| Metric | Type | Description |
|--------|------|-------------|
| `incident_slayer_http_requests_total` | Counter | Total HTTP requests by method/route/status |
| `incident_slayer_http_request_duration_seconds` | Histogram | Request latency distribution |
| `incident_slayer_tool_calls_total` | Counter | MCP tool invocations by tool |
| `incident_slayer_incidents_detected_total` | Counter | Incidents detected by type/severity |
| `incident_slayer_remediation_actions_total` | Counter | Actions by action/status |
| `incident_slayer_process_*` | Gauge | Node.js process metrics (CPU, memory, handles) |
| `incident_slayer_nodejs_*` | Gauge | Node.js runtime metrics (heap, GC, event loop) |

### Dashboard Panels
1. HTTP Request Rate — requests/second over time
2. HTTP Latency (p95) — tail latency tracking
3. Tool Call Counts — which MCP tools are used most
4. Incidents Detected — incident counter with severity thresholds
5. Remediation Actions — pie chart of action outcomes
6. Node.js Memory — RSS and heap usage
7. Event Loop Lag — runtime health indicator
8. Error Rate — 4xx and 5xx rates

---

## Self-Optimization Loop

The Observer agent creates a **feedback loop** that makes the system progressively cheaper and faster:

```
Execution → OTEL Traces → Observer Agent → Suggestions
     ↑                                         │
     └─────── Apply Optimization ◄──────────────┘
```

**Example optimizations**:
- "Detection is trivial — switch from GPT-4o ($0.03) to Ollama (free)"
- "Analyzer is pulling 50 logs but only using 5 — reduce context window"
- "Slack notifications are sent one-by-one — batch into daily digest"
- "Pipeline takes 12s — parallelize Detector + Log fetch"

---

## Multi-LLM Strategy

| Agent | Default Model | Fallback | Rationale |
|-------|--------------|----------|-----------|
| Detector | Ollama/llama3 | GPT-4o-mini | Simple threshold logic, speed matters |
| Analyzer | GPT-4o | Claude Sonnet | Complex reasoning, accuracy critical |
| Remediator | Ollama/llama3 | GPT-4o-mini | Structured decision tree |
| Observer | Ollama/llama3 | GPT-4o-mini | Meta-analysis, low stakes |

This routing strategy keeps the **per-incident cost under $0.05** while maintaining high accuracy for critical analysis tasks.
