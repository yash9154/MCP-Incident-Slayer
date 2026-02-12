/**
 * MCP Tool: Remediation Executor
 *
 * Executes safe, policy-compliant remediation actions.
 * All actions are validated against an allowlist and logged
 * to SQLite for full audit trail.
 *
 * Policy Rules:
 *   - Only allowed: scale_pods, restart_service, notify_slack
 *   - No destructive operations without approval
 *   - All executions logged with full context
 *
 * Endpoints:
 *   POST /execute  — Execute a remediation action
 *   GET  /history  — View execution audit trail
 *   GET  /actions  — List available actions and schemas
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const database = require('../lib/database');

const router = express.Router();

// ── Allowed Actions Registry ───────────────────────────────

const ALLOWED_ACTIONS = {
    scale_pods: {
        description: 'Scale a Kubernetes deployment to the specified replica count',
        required_params: ['service', 'replicas'],
        validate: (params) => {
            const errors = [];
            if (typeof params.service !== 'string' || !/^[a-z0-9-]+$/.test(params.service)) {
                errors.push('service must be a lowercase alphanumeric string with dashes');
            }
            if (typeof params.replicas !== 'number' || params.replicas < 1 || params.replicas > 20) {
                errors.push('replicas must be a number between 1 and 20');
            }
            return errors;
        },
        simulate: (params) => ({
            message: `Scaled ${params.service} to ${params.replicas} replicas`,
            previous_replicas: Math.floor(Math.random() * 3) + 1,
            new_replicas: params.replicas,
            estimated_ready_seconds: Math.floor(Math.random() * 30) + 10,
        }),
    },

    restart_service: {
        description: 'Perform a rolling restart of a service (zero-downtime)',
        required_params: ['service'],
        validate: (params) => {
            const errors = [];
            if (typeof params.service !== 'string' || !/^[a-z0-9-]+$/.test(params.service)) {
                errors.push('service must be a lowercase alphanumeric string with dashes');
            }
            return errors;
        },
        simulate: (params) => ({
            message: `Rolling restart initiated for ${params.service}`,
            strategy: params.strategy || 'rolling',
            pods_restarting: Math.floor(Math.random() * 3) + 1,
            estimated_completion_seconds: Math.floor(Math.random() * 60) + 30,
        }),
    },

    notify_slack: {
        description: 'Send a notification to the configured Slack channel',
        required_params: ['channel', 'message'],
        validate: (params) => {
            const errors = [];
            if (typeof params.channel !== 'string' || !/^#?[a-z0-9_-]+$/.test(params.channel)) {
                errors.push('channel must be a valid Slack channel name');
            }
            if (typeof params.message !== 'string' || params.message.length < 1 || params.message.length > 2000) {
                errors.push('message must be a string between 1 and 2000 characters');
            }
            return errors;
        },
        simulate: (params) => ({
            message: `Notification sent to ${params.channel}`,
            slack_message: params.message,
            severity: params.severity || 'info',
            delivered: true,
            timestamp: new Date().toISOString(),
        }),
    },
};

// ── Initialization ─────────────────────────────────────────

let tablesReady = false;

async function ensureTables() {
    if (tablesReady) return;

    await database.getDatabase();

    database.exec(`
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      params TEXT NOT NULL,
      result TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER DEFAULT 0
    )
  `);

    console.log('[remediation-executor] Actions table ready');
    tablesReady = true;
}

// Middleware to ensure DB is ready
router.use(async (req, res, next) => {
    try {
        await ensureTables();
        next();
    } catch (error) {
        console.error('[remediation-executor] DB init error:', error.message);
        res.status(500).json({ success: false, error: 'Database initialization failed' });
    }
});

// ── Routes ─────────────────────────────────────────────────

/**
 * POST /execute
 * Execute a remediation action.
 * Body: { action: string, params: object }
 */
router.post('/execute', (req, res) => {
    const startTime = Date.now();

    try {
        const { action, params } = req.body;

        if (!action) {
            return res.status(400).json({ success: false, error: 'Missing required field: action' });
        }
        if (!params || typeof params !== 'object') {
            return res.status(400).json({ success: false, error: 'Missing or invalid field: params (must be an object)' });
        }

        // Policy check — is this action allowed?
        if (!ALLOWED_ACTIONS[action]) {
            const rejectionId = uuidv4();

            database.run(
                `INSERT INTO actions (id, timestamp, action, params, result, status, duration_ms) VALUES ($id, $ts, $action, $params, $result, $status, $dur)`,
                {
                    $id: rejectionId,
                    $ts: new Date().toISOString(),
                    $action: action,
                    $params: JSON.stringify(params),
                    $result: JSON.stringify({ error: `Action "${action}" is not allowed` }),
                    $status: 'rejected',
                    $dur: Date.now() - startTime,
                }
            );
            database.saveToDisk();

            console.warn(`[remediation-executor] REJECTED action="${action}" — not in allowlist`);

            return res.status(403).json({
                success: false,
                error: `Action "${action}" is not permitted by policy`,
                allowed_actions: Object.keys(ALLOWED_ACTIONS),
                execution_id: rejectionId,
            });
        }

        // Check required params
        const actionDef = ALLOWED_ACTIONS[action];
        for (const required of actionDef.required_params) {
            if (params[required] === undefined || params[required] === null || params[required] === '') {
                return res.status(400).json({
                    success: false,
                    error: `Missing required parameter: ${required}`,
                });
            }
        }

        // Validate parameters
        const validationErrors = actionDef.validate(params);
        if (validationErrors.length > 0) {
            console.warn(`[remediation-executor] REJECTED action="${action}" — validation: ${validationErrors.join('; ')}`);
            return res.status(400).json({
                success: false,
                error: 'Parameter validation failed',
                validation_errors: validationErrors,
            });
        }

        // Simulate execution
        const simulationResult = actionDef.simulate(params);
        const durationMs = Date.now() - startTime;
        const executionId = uuidv4();

        database.run(
            `INSERT INTO actions (id, timestamp, action, params, result, status, duration_ms) VALUES ($id, $ts, $action, $params, $result, $status, $dur)`,
            {
                $id: executionId,
                $ts: new Date().toISOString(),
                $action: action,
                $params: JSON.stringify(params),
                $result: JSON.stringify(simulationResult),
                $status: 'success',
                $dur: durationMs,
            }
        );
        database.saveToDisk();

        console.log(`[remediation-executor] EXECUTED action="${action}" | ${durationMs}ms | id=${executionId}`);

        return res.json({
            success: true,
            execution_id: executionId,
            action,
            params,
            result: simulationResult,
            duration_ms: durationMs,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[remediation-executor] Execution error:', error.message);
        return res.status(500).json({ success: false, error: 'Internal error', details: error.message });
    }
});

/**
 * GET /history
 * Returns the execution audit trail.
 * Query params: status (success|rejected|error), limit (default 50)
 */
router.get('/history', (req, res) => {
    try {
        const { status } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

        let query = 'SELECT * FROM actions WHERE 1=1';
        const params = {};

        if (status) {
            const valid = ['success', 'rejected', 'error'];
            if (!valid.includes(status)) {
                return res.status(400).json({ success: false, error: `Invalid status. Must be: ${valid.join(', ')}` });
            }
            query += ' AND status = $status';
            params.$status = status;
        }

        query += ' ORDER BY timestamp DESC LIMIT $limit';
        params.$limit = limit;

        const rows = database.queryAll(query, params);

        console.log(`[remediation-executor] History: ${rows.length} records`);

        return res.json({
            success: true,
            count: rows.length,
            data: rows.map((r) => ({ ...r, params: JSON.parse(r.params), result: JSON.parse(r.result) })),
        });
    } catch (error) {
        console.error('[remediation-executor] History error:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to fetch history', details: error.message });
    }
});

/**
 * GET /actions
 * List all available actions and their parameter schemas.
 */
router.get('/actions', (req, res) => {
    try {
        const actions = Object.entries(ALLOWED_ACTIONS).map(([name, def]) => ({
            name,
            description: def.description,
            required_params: def.required_params,
        }));

        return res.json({
            success: true,
            policy: 'Only actions in this list are permitted. All others are rejected.',
            data: actions,
        });
    } catch (error) {
        console.error('[remediation-executor] List error:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to list actions', details: error.message });
    }
});

module.exports = router;
module.exports.ALLOWED_ACTIONS = ALLOWED_ACTIONS;
module.exports._resetTablesReady = () => { tablesReady = false; };
