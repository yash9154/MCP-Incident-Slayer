/**
 * MCP Tool: Logs Database
 *
 * Persistent, queryable log store backed by SQLite (sql.js WASM).
 * Auto-creates tables and seeds realistic sample data on first run.
 *
 * Endpoints:
 *   GET  /logs       — Query logs (filter by level, service, search, limit)
 *   POST /logs       — Insert a new log entry
 *   GET  /logs/stats — Aggregate log statistics
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const database = require('../lib/database');

const router = express.Router();

// ── Initialization ─────────────────────────────────────────

/** Flag to track whether we've initialized tables for this session */
let tablesReady = false;

/**
 * Ensure the logs table exists and is seeded with sample data.
 * Called lazily on first request.
 */
async function ensureTables() {
    if (tablesReady) return;

    await database.getDatabase();

    database.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      service TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT DEFAULT '{}'
    )
  `);

    // Seed sample data only if table is empty
    const row = database.queryOne('SELECT COUNT(*) as count FROM logs');
    if (!row || row.count === 0) {
        seedSampleLogs();
    } else {
        console.log(`[logs-db] ${row.count} existing log records found`);
    }

    tablesReady = true;
}

/**
 * Seed realistic sample log entries simulating a production K8s environment.
 */
function seedSampleLogs() {
    const now = Date.now();
    const logs = [
        { level: 'info', service: 'api-gateway', message: 'Request processed: GET /api/v1/users (200) 45ms', offset: -3600000 },
        { level: 'info', service: 'auth-service', message: 'JWT token validated for user_id=u-9823. Session refresh completed.', offset: -3500000 },
        { level: 'debug', service: 'payment-service', message: 'Stripe webhook received: evt_1Ox2Hq. Processing payment confirmation.', offset: -3400000 },
        { level: 'info', service: 'k8s-scheduler', message: 'Pod api-gateway-7d9f8b6c4-xk2lp scheduled on node prod-k8s-node-01.', offset: -3200000 },
        { level: 'warn', service: 'api-gateway', message: 'Response time exceeded threshold: GET /api/v1/reports avg=2340ms (threshold=1000ms)', offset: -2800000 },
        { level: 'warn', service: 'database-proxy', message: 'Connection pool utilization at 85% (170/200). Consider scaling.', offset: -2600000 },
        { level: 'warn', service: 'cache-service', message: 'Redis memory at 78%. Eviction policy: allkeys-lru. Monitor closely.', offset: -2400000 },
        { level: 'warn', service: 'k8s-scheduler', message: 'Node prod-k8s-node-01 memory pressure detected. Pods may be evicted.', offset: -2000000 },
        { level: 'error', service: 'api-gateway', message: 'Upstream timeout: payment-service:8080 after 30000ms. Circuit breaker OPEN.', offset: -1500000 },
        { level: 'error', service: 'payment-service', message: 'OOMKilled: Container exceeded memory limit (512Mi). Pod restarting (attempt 3/5).', offset: -1200000 },
        { level: 'error', service: 'database-proxy', message: 'Query timeout on replica-02: SELECT * FROM transactions (exceeded 30s limit)', offset: -1000000 },
        { level: 'error', service: 'k8s-controller', message: 'CrashLoopBackOff: Pod payment-service-5c8d7f9a2-mn4kp. Back-off 5m0s.', offset: -800000 },
        { level: 'fatal', service: 'payment-service', message: 'CRITICAL: All replicas unhealthy. Service degraded. Escalation triggered.', offset: -600000 },
        { level: 'error', service: 'alertmanager', message: 'PagerDuty alert fired: PaymentServiceDown severity=critical team=platform-sre', offset: -500000 },
        { level: 'info', service: 'k8s-controller', message: 'HPA triggered: scaling payment-service from 3 to 5 replicas based on CPU metric.', offset: -300000 },
        { level: 'info', service: 'payment-service', message: 'Pod payment-service-5c8d7f9a2-zz9ab started. Health check passed.', offset: -120000 },
        { level: 'warn', service: 'api-gateway', message: 'Circuit breaker HALF-OPEN for payment-service. Testing upstream health.', offset: -60000 },
    ];

    for (const entry of logs) {
        database.run(
            `INSERT INTO logs (id, timestamp, level, service, message, metadata) VALUES ($id, $timestamp, $level, $service, $message, $metadata)`,
            {
                $id: uuidv4(),
                $timestamp: new Date(now + entry.offset).toISOString(),
                $level: entry.level,
                $service: entry.service,
                $message: entry.message,
                $metadata: JSON.stringify({ source: 'seed', environment: 'production' }),
            }
        );
    }

    database.saveToDisk();
    console.log(`[logs-db] Seeded ${logs.length} sample log entries`);
}

// ── Middleware — ensure DB is ready before handling requests ─
router.use(async (req, res, next) => {
    try {
        await ensureTables();
        next();
    } catch (error) {
        console.error('[logs-db] DB init error:', error.message);
        res.status(500).json({ success: false, error: 'Database initialization failed' });
    }
});

// ── Routes ─────────────────────────────────────────────────

/**
 * GET /logs
 * Query logs with optional filters.
 * Query params: level, service, search, limit (default 50), offset (default 0)
 */
router.get('/logs', (req, res) => {
    try {
        const { level, service, search } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        // Validate level if provided
        if (level) {
            const validLevels = ['info', 'warn', 'error', 'debug', 'fatal'];
            if (!validLevels.includes(level)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid level "${level}". Must be one of: ${validLevels.join(', ')}`,
                });
            }
        }

        // Build query dynamically — sql.js uses $param notation
        let query = 'SELECT * FROM logs WHERE 1=1';
        const params = {};

        if (level) {
            query += ' AND level = $level';
            params.$level = level;
        }
        if (service) {
            query += ' AND service = $service';
            params.$service = service;
        }
        if (search) {
            query += " AND message LIKE $search";
            params.$search = `%${search}%`;
        }

        query += ' ORDER BY timestamp DESC LIMIT $limit OFFSET $offset';
        params.$limit = limit;
        params.$offset = offset;

        const rows = database.queryAll(query, params);

        console.log(`[logs-db] Query returned ${rows.length} logs (level=${level || 'all'}, service=${service || 'all'})`);

        return res.json({
            success: true,
            count: rows.length,
            filters: { level: level || null, service: service || null, search: search || null },
            data: rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadata || '{}') })),
        });
    } catch (error) {
        console.error('[logs-db] Query error:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to query logs', details: error.message });
    }
});

/**
 * POST /logs
 * Insert a new log entry.
 * Body: { level, service, message, metadata? }
 */
router.post('/logs', (req, res) => {
    try {
        const { level, service, message, metadata } = req.body;

        if (!level || !service || !message) {
            return res.status(400).json({ success: false, error: 'Missing required fields: level, service, message' });
        }

        const validLevels = ['info', 'warn', 'error', 'debug', 'fatal'];
        if (!validLevels.includes(level)) {
            return res.status(400).json({
                success: false,
                error: `Invalid level "${level}". Must be one of: ${validLevels.join(', ')}`,
            });
        }

        const id = uuidv4();
        const timestamp = new Date().toISOString();

        database.run(
            `INSERT INTO logs (id, timestamp, level, service, message, metadata) VALUES ($id, $timestamp, $level, $service, $message, $metadata)`,
            { $id: id, $timestamp: timestamp, $level: level, $service: service, $message: message, $metadata: JSON.stringify(metadata || {}) }
        );
        database.saveToDisk();

        console.log(`[logs-db] Inserted: [${level.toUpperCase()}] ${service} — ${message.substring(0, 80)}`);

        return res.status(201).json({
            success: true,
            data: { id, timestamp, level, service, message, metadata: metadata || {} },
        });
    } catch (error) {
        console.error('[logs-db] Insert error:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to insert log', details: error.message });
    }
});

/**
 * GET /logs/stats
 * Returns aggregate log statistics — counts by level and service.
 */
router.get('/logs/stats', (req, res) => {
    try {
        const byLevel = database.queryAll('SELECT level, COUNT(*) as count FROM logs GROUP BY level ORDER BY count DESC');
        const byService = database.queryAll('SELECT service, COUNT(*) as count FROM logs GROUP BY service ORDER BY count DESC');
        const total = database.queryOne('SELECT COUNT(*) as count FROM logs');

        console.log(`[logs-db] Stats: ${total ? total.count : 0} total logs`);

        return res.json({
            success: true,
            data: { total: total ? total.count : 0, by_level: byLevel, by_service: byService },
        });
    } catch (error) {
        console.error('[logs-db] Stats error:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to fetch stats', details: error.message });
    }
});

module.exports = router;
module.exports.ensureTables = ensureTables;
module.exports._resetTablesReady = () => { tablesReady = false; };
