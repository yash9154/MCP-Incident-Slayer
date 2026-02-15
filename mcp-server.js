/**
 * MCP Incident Slayer — MCP Protocol Server
 *
 * Wraps our tools in the Model Context Protocol using Streamable HTTP.
 * Creates a fresh MCP server per request for maximum compatibility.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { v4: uuidv4 } = require('uuid');
const client = require('prom-client');

const database = require('./lib/database');

// ── Prometheus Metrics ─────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const toolCallsCounter = new client.Counter({
    name: 'incident_slayer_tool_calls_total',
    help: 'Total MCP tool invocations',
    labelNames: ['tool'],
    registers: [register],
});

const incidentsCounter = new client.Counter({
    name: 'incident_slayer_incidents_detected_total',
    help: 'Total incidents detected',
    labelNames: ['type', 'severity'],
    registers: [register],
});

const remediationCounter = new client.Counter({
    name: 'incident_slayer_remediation_actions_total',
    help: 'Remediation actions executed',
    labelNames: ['action', 'status'],
    registers: [register],
});

const httpRequestDuration = new client.Histogram({
    name: 'incident_slayer_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [register],
});

// ── Slack Webhook ──────────────────────────────────────────
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

async function sendSlackMessage(channel, message) {
    if (!SLACK_WEBHOOK_URL) return { sent: false, reason: 'No SLACK_WEBHOOK_URL configured (simulated)' };
    try {
        const response = await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel,
                text: `⚔️ *MCP Incident Slayer*\n${message}`,
                username: 'Incident Slayer Bot',
                icon_emoji: ':crossed_swords:',
            }),
        });
        return { sent: true, status: response.status };
    } catch (err) {
        return { sent: false, reason: err.message };
    }
}

const app = express();
const MCP_PORT = parseInt(process.env.MCP_PORT, 10) || 4000;

// ── CORS ───────────────────────────────────────────────────
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json());

// ── Metrics simulation ─────────────────────────────────────

let anomalyMode = false;

function generateMetrics() {
    const base = {
        cpu_percent: 25 + Math.random() * 30,
        memory_percent: 40 + Math.random() * 25,
        disk_percent: 30 + Math.random() * 25,
        network_in_mbps: 50 + Math.random() * 100,
        network_out_mbps: 30 + Math.random() * 80,
        request_rate_rps: 100 + Math.random() * 400,
        error_rate_percent: 0.1 + Math.random() * 2,
        latency_p99_ms: 50 + Math.random() * 150,
        pods_running: 5,
        pods_desired: 5,
    };

    if (anomalyMode) {
        base.cpu_percent = 85 + Math.random() * 15;
        base.memory_percent = 88 + Math.random() * 12;
        base.error_rate_percent = 8 + Math.random() * 10;
        base.latency_p99_ms = 500 + Math.random() * 2000;
        base.pods_running = 2 + Math.floor(Math.random() * 2);
        base.pods_desired = 5;
    }

    return { id: uuidv4(), timestamp: new Date().toISOString(), ...base };
}

// ── Remediation policies ───────────────────────────────────

const ALLOWED_ACTIONS = {
    scale_pods: {
        description: 'Scale pods for a service',
        requiredParams: ['service', 'replicas'],
        validate: (params) => {
            if (typeof params.replicas !== 'number' || params.replicas < 1 || params.replicas > 20) {
                return 'replicas must be a number between 1 and 20';
            }
            return null;
        },
        simulate: (params) => `Scaled ${params.service} to ${params.replicas} replicas`,
    },
    restart_service: {
        description: 'Restart a service with rolling restart',
        requiredParams: ['service'],
        validate: () => null,
        simulate: (params) => `Rolling restart initiated for: ${params.service}`,
    },
    notify_slack: {
        description: 'Send a real Slack notification (if SLACK_WEBHOOK_URL is set) or simulate it',
        requiredParams: ['channel', 'message'],
        validate: () => null,
        simulate: async (params) => {
            const result = await sendSlackMessage(params.channel, params.message);
            return result.sent
                ? `Slack notification SENT to ${params.channel}: ${params.message}`
                : `Notification simulated to ${params.channel}: ${params.message} (${result.reason})`;
        },
    },
    clear_cache: {
        description: 'Clear application cache for a service',
        requiredParams: ['service'],
        validate: () => null,
        simulate: (params) => `Cache cleared for service: ${params.service}. Memory freed.`,
    },
    rollback_deployment: {
        description: 'Rollback a service to the previous stable version',
        requiredParams: ['service', 'version'],
        validate: (params) => {
            if (!params.version || typeof params.version !== 'string') {
                return 'version must be a valid version string (e.g. "v1.2.3")';
            }
            return null;
        },
        simulate: (params) => `Rolled back ${params.service} to version ${params.version}`,
    },
    drain_node: {
        description: 'Drain a Kubernetes node to safely evict pods before maintenance',
        requiredParams: ['node'],
        validate: () => null,
        simulate: (params) => `Node ${params.node} drained. Pods rescheduled to healthy nodes.`,
    },
};

// ── Register MCP Tools ─────────────────────────────────────

function registerTools(server) {
    server.tool('fetch_metrics', 'Fetch current infrastructure metrics including CPU, memory, disk, network, error rate, and pod status.', {}, async () => {
        toolCallsCounter.inc({ tool: 'fetch_metrics' });
        return { content: [{ type: 'text', text: JSON.stringify(generateMetrics(), null, 2) }] };
    });

    server.tool('toggle_anomaly_mode', 'Enable or disable anomaly simulation mode for testing.', {
        enabled: { type: 'boolean', description: 'true to enable, false to disable' },
    }, async ({ enabled }) => {
        toolCallsCounter.inc({ tool: 'toggle_anomaly_mode' });
        anomalyMode = !!enabled;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, anomaly_mode: anomalyMode, message: `Anomaly mode ${anomalyMode ? 'ENABLED' : 'DISABLED'}` }) }] };
    });

    server.tool('query_logs', 'Query the log database. Filter by level, service, or search text.', {
        level: { type: 'string', description: 'Log level: error, warn, info, debug' },
        service: { type: 'string', description: 'Service name filter' },
        search: { type: 'string', description: 'Text search in messages' },
        limit: { type: 'number', description: 'Max logs to return (default 50)' },
    }, async (params) => {
        toolCallsCounter.inc({ tool: 'query_logs' });
        try {
            await database.getDatabase();
            let query = 'SELECT * FROM logs WHERE 1=1';
            const qp = [];
            if (params.level) { query += ' AND level = ?'; qp.push(params.level); }
            if (params.service) { query += ' AND service = ?'; qp.push(params.service); }
            if (params.search) { query += ' AND message LIKE ?'; qp.push(`%${params.search}%`); }
            query += ' ORDER BY timestamp DESC';
            query += ` LIMIT ${parseInt(params.limit, 10) || 50}`;
            const rows = database.queryAll(query, qp);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, count: rows.length, logs: rows }, null, 2) }] };
        } catch (error) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }) }] };
        }
    });

    server.tool('get_log_stats', 'Get aggregated log statistics by level and service.', {}, async () => {
        toolCallsCounter.inc({ tool: 'get_log_stats' });
        try {
            await database.getDatabase();
            const byLevel = database.queryAll('SELECT level, COUNT(*) as count FROM logs GROUP BY level ORDER BY count DESC');
            const byService = database.queryAll('SELECT service, COUNT(*) as count FROM logs GROUP BY service ORDER BY count DESC');
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, by_level: byLevel, by_service: byService }, null, 2) }] };
        } catch (error) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }) }] };
        }
    });

    server.tool('execute_remediation', 'Execute a remediation action. Allowed: scale_pods, restart_service, notify_slack, clear_cache, rollback_deployment, drain_node. Pass action name as "action" and parameters as "params" object.', {
        action: { type: 'string', description: 'The action name to execute. Must be one of: scale_pods, restart_service, notify_slack, clear_cache, rollback_deployment, drain_node' },
        params: { type: 'object', description: 'Action parameters (e.g. {"service":"payment-service","replicas":5})' },
        reason: { type: 'string', description: 'Reason for the action' },
    }, async (args) => {
        toolCallsCounter.inc({ tool: 'execute_remediation' });
        // Handle multiple parameter formats from different LLMs
        const action = args.action || args.name || args.tool || undefined;
        const params = args.params || {};
        const reason = args.reason || args.description || 'Agent action';

        // If action is still undefined, try to find it in the args
        if (!action) {
            // Check if the action name was passed as a top-level key
            const possibleActions = Object.keys(ALLOWED_ACTIONS);
            const foundAction = possibleActions.find(a => args[a] !== undefined || Object.values(args).includes(a));
            if (foundAction) {
                return handleRemediation(foundAction, typeof args[foundAction] === 'object' ? args[foundAction] : params, reason);
            }
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Action is undefined. Please pass "action" parameter with one of: ${possibleActions.join(', ')}. Example: {"action": "restart_service", "params": {"service": "payment-service"}}` }) }] };
        }

        return handleRemediation(action, params, reason);
    });

    async function handleRemediation(action, params, reason) {
        const actionDef = ALLOWED_ACTIONS[action];
        if (!actionDef) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Action '${action}' not allowed. Allowed: ${Object.keys(ALLOWED_ACTIONS).join(', ')}` }) }] };
        }
        const ap = params || {};
        for (const p of actionDef.requiredParams) {
            if (ap[p] === undefined) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Missing required parameter: ${p}. Required: ${actionDef.requiredParams.join(', ')}` }) }] };
        }
        const valErr = actionDef.validate(ap);
        if (valErr) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: valErr }) }] };

        const result = typeof actionDef.simulate === 'function' && actionDef.simulate.constructor.name === 'AsyncFunction'
            ? await actionDef.simulate(ap)
            : actionDef.simulate(ap);
        remediationCounter.inc({ action, status: 'completed' });
        try {
            await database.getDatabase();
            database.run('INSERT INTO executions (id, action, params, reason, result, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [uuidv4(), action, JSON.stringify(ap), reason || 'Agent action', result, 'completed', new Date().toISOString()]);
        } catch (e) { /* non-critical */ }

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, action, params: ap, result, timestamp: new Date().toISOString() }, null, 2) }] };
    }

    server.tool('list_actions', 'List all available remediation actions.', {}, async () => {
        toolCallsCounter.inc({ tool: 'list_actions' });
        const actions = Object.entries(ALLOWED_ACTIONS).map(([name, def]) => ({
            name, description: def.description, required_params: def.requiredParams,
        }));
        return { content: [{ type: 'text', text: JSON.stringify({ actions }, null, 2) }] };
    });

    // ── New Tools ───────────────────────────────────────────

    server.tool('get_incident_history', 'Get the history of all past remediation actions and incidents. Shows what actions were taken, when, and why.', {
        limit: { type: 'number', description: 'Max records to return (default 20)' },
    }, async (params) => {
        toolCallsCounter.inc({ tool: 'get_incident_history' });
        try {
            await database.getDatabase();
            const limit = parseInt(params.limit, 10) || 20;
            const rows = database.queryAll(
                'SELECT * FROM executions ORDER BY timestamp DESC LIMIT ?', [limit]
            );
            const history = rows.map(r => ({
                ...r,
                params: JSON.parse(r.params || '{}'),
            }));
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, count: history.length, history }, null, 2) }] };
        } catch (error) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }) }] };
        }
    });

    server.tool('get_system_status', 'Get a comprehensive system status overview including metrics, log stats, anomaly mode state, and recent incidents in one call.', {}, async () => {
        toolCallsCounter.inc({ tool: 'get_system_status' });
        try {
            await database.getDatabase();
            const metrics = generateMetrics();
            const logsByLevel = database.queryAll('SELECT level, COUNT(*) as count FROM logs GROUP BY level ORDER BY count DESC');
            const recentExecutions = database.queryAll('SELECT * FROM executions ORDER BY timestamp DESC LIMIT 5');

            // Detect active incidents
            const incidents = [];
            if (metrics.cpu_percent > 80) incidents.push({ type: 'HIGH_CPU', severity: 'critical', value: `${metrics.cpu_percent.toFixed(1)}%` });
            if (metrics.memory_percent > 85) incidents.push({ type: 'HIGH_MEMORY', severity: 'critical', value: `${metrics.memory_percent.toFixed(1)}%` });
            if (metrics.disk_percent > 90) incidents.push({ type: 'HIGH_DISK', severity: 'warning', value: `${metrics.disk_percent.toFixed(1)}%` });
            if (metrics.error_rate_percent > 5) incidents.push({ type: 'HIGH_ERROR_RATE', severity: 'critical', value: `${metrics.error_rate_percent.toFixed(1)}%` });
            if (metrics.pods_running < metrics.pods_desired) incidents.push({ type: 'POD_SHORTAGE', severity: 'warning', value: `${metrics.pods_running}/${metrics.pods_desired}` });
            if (metrics.latency_p99_ms > 500) incidents.push({ type: 'HIGH_LATENCY', severity: 'warning', value: `${metrics.latency_p99_ms.toFixed(0)}ms` });

            const status = {
                overall_health: incidents.length === 0 ? 'HEALTHY' : (incidents.some(i => i.severity === 'critical') ? 'CRITICAL' : 'DEGRADED'),
                anomaly_mode: anomalyMode,
                active_incidents: incidents,
                metrics,
                log_summary: logsByLevel,
                recent_actions: recentExecutions.map(r => ({ ...r, params: JSON.parse(r.params || '{}') })),
                timestamp: new Date().toISOString(),
            };

            return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
        } catch (error) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }) }] };
        }
    });
}

// ── Session Management ─────────────────────────────────────

const sessions = new Map(); // sessionId -> { server, transport }

async function createSession() {
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => uuidv4(),
    });

    const server = new McpServer({ name: 'incident-slayer-tools', version: '1.0.0' });
    registerTools(server);
    await server.connect(transport);

    return { server, transport };
}

// ── MCP Endpoint ───────────────────────────────────────────

app.post('/mcp', async (req, res) => {
    const body = req.body;
    const sessionId = req.headers['mcp-session-id'];

    console.log(`[mcp] POST /mcp | session: ${sessionId || 'none'} | method: ${body?.method || 'unknown'}`);

    try {
        // 1. If we have a valid session, use it
        if (sessionId && sessions.has(sessionId)) {
            console.log(`[mcp] Routing to existing session: ${sessionId}`);
            const session = sessions.get(sessionId);
            await session.transport.handleRequest(req, res, body);
            return;
        }

        // 2. For ANY request without a valid session, create a fresh one
        console.log('[mcp] Creating new session...');
        const session = await createSession();

        // The session ID is set AFTER the initialize is handled,
        // so we need a callback to store it
        const originalHandleRequest = session.transport.handleRequest.bind(session.transport);

        await originalHandleRequest(req, res, body);

        // After handling, the session ID should now be set
        const newSessionId = session.transport.sessionId;
        if (newSessionId) {
            sessions.set(newSessionId, session);
            console.log(`[mcp] Session stored: ${newSessionId}`);

            session.transport.onclose = () => {
                console.log(`[mcp] Session closed: ${newSessionId}`);
                sessions.delete(newSessionId);
            };
        } else {
            console.log('[mcp] Warning: session ID still undefined after handling');
        }
    } catch (error) {
        console.error('[mcp] Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: error.message },
                id: body?.id || null,
            });
        }
    }
});

app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    console.log(`[mcp] GET /mcp | session: ${sessionId || 'none'}`);

    try {
        if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId);
            await session.transport.handleRequest(req, res);
            return;
        }

        // No session for GET — create one
        const session = await createSession();
        await session.transport.handleRequest(req, res);

        const newSessionId = session.transport.sessionId;
        if (newSessionId) {
            sessions.set(newSessionId, session);
        }
    } catch (error) {
        console.error('[mcp] GET Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        await session.transport.handleRequest(req, res);
        sessions.delete(sessionId);
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// ── Dashboard REST API ─────────────────────────────────────

const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.redirect('/dashboard.html');
});

app.get('/api/metrics', (req, res) => {
    res.json(generateMetrics());
});

app.post('/api/anomaly', (req, res) => {
    anomalyMode = !!req.body.enabled;
    res.json({ success: true, anomaly_mode: anomalyMode });
});

app.get('/api/logs', async (req, res) => {
    try {
        await database.getDatabase();
        const limit = parseInt(req.query.limit, 10) || 50;
        const logs = database.queryAll('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?', [limit]);
        res.json({ success: true, logs });
    } catch (error) {
        res.json({ success: false, error: error.message, logs: [] });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        await database.getDatabase();
        const rows = database.queryAll('SELECT * FROM executions ORDER BY timestamp DESC LIMIT 20');
        const history = rows.map(r => ({ ...r, params: JSON.parse(r.params || '{}') }));
        res.json({ success: true, history });
    } catch (error) {
        res.json({ success: false, error: error.message, history: [] });
    }
});

// ── Health Check ───────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'mcp-incident-slayer',
        protocol: 'MCP Streamable HTTP',
        active_sessions: sessions.size,
        uptime_seconds: Math.floor(process.uptime()),
    });
});

// ── Prometheus Metrics Endpoint ─────────────────────────────

app.get('/prom-metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (error) {
        res.status(500).end(error.message);
    }
});

// ── Startup ────────────────────────────────────────────────

async function startMcpServer() {
    try {
        await database.getDatabase();
        console.log('[mcp] Database initialized');

        app.listen(MCP_PORT, () => {
            console.log('');
            console.log('╔══════════════════════════════════════════════════════╗');
            console.log('║     ⚔️  MCP INCIDENT SLAYER — MCP SERVER  ⚔️        ║');
            console.log('╠══════════════════════════════════════════════════════╣');
            console.log(`║  MCP Endpoint: http://localhost:${MCP_PORT}/mcp             ║`);
            console.log(`║  Dashboard:    http://localhost:${MCP_PORT}                  ║`);
            console.log(`║  Health:       http://localhost:${MCP_PORT}/health           ║`);
            console.log('╠══════════════════════════════════════════════════════╣');
            console.log('║  MCP Tools (8):                                    ║');
            console.log('║    • fetch_metrics         — Infra metrics         ║');
            console.log('║    • toggle_anomaly_mode   — Anomaly simulation    ║');
            console.log('║    • query_logs            — Search logs           ║');
            console.log('║    • get_log_stats         — Log statistics        ║');
            console.log('║    • execute_remediation   — Safe actions (6)      ║');
            console.log('║    • list_actions          — Available actions     ║');
            console.log('║    • get_incident_history  — Past incidents        ║');
            console.log('║    • get_system_status     — Full system overview  ║');
            console.log('╚══════════════════════════════════════════════════════╝');
            console.log('');
            console.log('[mcp] Ready for Archestra connections!');
        });
    } catch (error) {
        console.error('[mcp] Failed to start:', error.message);
        process.exit(1);
    }
}

startMcpServer();
