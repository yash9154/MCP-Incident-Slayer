/**
 * MCP Incident Slayer — Main Server
 *
 * Express server that mounts all MCP tool routers and exposes
 * Prometheus metrics, health checks, and a status dashboard endpoint.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const promClient = require('prom-client');
const database = require('./lib/database');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 4000;

// ── Prometheus Metrics ─────────────────────────────────────

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
promClient.collectDefaultMetrics({ prefix: 'incident_slayer_' });

// Custom counters
const httpRequestsTotal = new promClient.Counter({
    name: 'incident_slayer_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
});

const httpRequestDuration = new promClient.Histogram({
    name: 'incident_slayer_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});

const toolCallsTotal = new promClient.Counter({
    name: 'incident_slayer_tool_calls_total',
    help: 'Total MCP tool invocations',
    labelNames: ['tool'],
});

const incidentsDetected = new promClient.Counter({
    name: 'incident_slayer_incidents_detected_total',
    help: 'Total incidents detected',
    labelNames: ['type', 'severity'],
});

const remediationActions = new promClient.Counter({
    name: 'incident_slayer_remediation_actions_total',
    help: 'Total remediation actions executed',
    labelNames: ['action', 'status'],
});

// ── Middleware ──────────────────────────────────────────────

app.use(express.json());

// Request logging and Prometheus metrics middleware
app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationSec = durationNs / 1e9;

        // Normalize route for Prometheus labels (avoid high cardinality)
        const route = req.route ? req.route.path : req.path;

        httpRequestsTotal.inc({
            method: req.method,
            route: route,
            status_code: res.statusCode,
        });

        httpRequestDuration.observe(
            { method: req.method, route: route },
            durationSec
        );
    });

    next();
});

// Track tool calls
app.use('/metrics', (req, res, next) => { toolCallsTotal.inc({ tool: 'metrics-fetcher' }); next(); });
app.use('/logs', (req, res, next) => { toolCallsTotal.inc({ tool: 'logs-db' }); next(); });
app.use('/execute', (req, res, next) => { toolCallsTotal.inc({ tool: 'remediation-executor' }); next(); });
app.use('/history', (req, res, next) => { toolCallsTotal.inc({ tool: 'remediation-executor' }); next(); });
app.use('/actions', (req, res, next) => { toolCallsTotal.inc({ tool: 'remediation-executor' }); next(); });

// CORS headers for dashboard/UI access
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── Mount MCP Tool Routers ─────────────────────────────────

const metricsRouter = require('./tools/metrics-fetcher');
const logsRouter = require('./tools/logs-db');
const remediationRouter = require('./tools/remediation-executor');

app.use('/', metricsRouter);
app.use('/', logsRouter);
app.use('/', remediationRouter);

// ── Health & Status Endpoints ──────────────────────────────

/** GET /health — Liveness probe */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'mcp-incident-slayer',
        version: '1.0.0',
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});

/** GET /status — Comprehensive system status */
app.get('/status', async (req, res) => {
    try {
        const dbPath = database.getDbPath();
        const uptime = Math.floor(process.uptime());
        const memUsage = process.memoryUsage();

        res.json({
            success: true,
            data: {
                service: 'mcp-incident-slayer',
                version: '1.0.0',
                uptime_seconds: uptime,
                memory: {
                    rss_mb: Math.round(memUsage.rss / 1024 / 1024),
                    heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
                },
                database: { path: dbPath },
                tools: ['metrics-fetcher', 'logs-db', 'remediation-executor'],
                endpoints: {
                    metrics: 'GET /metrics',
                    metrics_history: 'GET /metrics/history',
                    anomaly_toggle: 'POST /metrics/anomaly',
                    logs: 'GET /logs',
                    logs_insert: 'POST /logs',
                    logs_stats: 'GET /logs/stats',
                    execute: 'POST /execute',
                    history: 'GET /history',
                    actions: 'GET /actions',
                    health: 'GET /health',
                    prometheus: 'GET /prom-metrics',
                },
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** GET /prom-metrics — Prometheus scrape endpoint */
app.get('/prom-metrics', async (req, res) => {
    try {
        res.set('Content-Type', promClient.register.contentType);
        res.end(await promClient.register.metrics());
    } catch (error) {
        res.status(500).end(error.message);
    }
});

// ── 404 Handler ────────────────────────────────────────────

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: `Route not found: ${req.method} ${req.path}`,
        available_routes: [
            'GET /health',
            'GET /status',
            'GET /metrics',
            'GET /metrics/history',
            'POST /metrics/anomaly',
            'GET /logs',
            'POST /logs',
            'GET /logs/stats',
            'POST /execute',
            'GET /history',
            'GET /actions',
            'GET /prom-metrics',
        ],
    });
});

// ── Global Error Handler ───────────────────────────────────

app.use((err, req, res, _next) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
});

// ── Startup ────────────────────────────────────────────────

async function startServer() {
    try {
        // Initialize database before accepting requests
        await database.getDatabase();
        console.log('[server] Database initialized');

        const server = app.listen(PORT, () => {
            console.log('');
            console.log('╔══════════════════════════════════════════════════════╗');
            console.log('║       ⚔️  MCP INCIDENT SLAYER — ONLINE  ⚔️          ║');
            console.log('╠══════════════════════════════════════════════════════╣');
            console.log(`║  Server:      http://localhost:${PORT}                 ║`);
            console.log(`║  Health:      http://localhost:${PORT}/health           ║`);
            console.log(`║  Status:      http://localhost:${PORT}/status           ║`);
            console.log(`║  Prometheus:  http://localhost:${PORT}/prom-metrics     ║`);
            console.log('╠══════════════════════════════════════════════════════╣');
            console.log('║  MCP Tools:                                        ║');
            console.log('║    GET  /metrics          — Infrastructure metrics  ║');
            console.log('║    GET  /logs             — Query log database      ║');
            console.log('║    POST /execute          — Run remediation action  ║');
            console.log('║    GET  /actions          — List available actions  ║');
            console.log('╚══════════════════════════════════════════════════════╝');
            console.log('');
        });

        // Graceful shutdown
        const shutdown = async (signal) => {
            console.log(`\n[server] ${signal} received. Shutting down gracefully...`);
            database.close();
            server.close(() => {
                console.log('[server] Server closed.');
                process.exit(0);
            });
            // Force exit after 5 seconds
            setTimeout(() => process.exit(1), 5000);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        return server;
    } catch (error) {
        console.error('[server] Failed to start:', error.message);
        process.exit(1);
    }
}

// Start only if run directly (not imported by tests)
if (require.main === module) {
    startServer();
}

// Exports for testing
module.exports = app;
module.exports.startServer = startServer;
module.exports.promMetrics = {
    httpRequestsTotal,
    httpRequestDuration,
    toolCallsTotal,
    incidentsDetected,
    remediationActions,
};
