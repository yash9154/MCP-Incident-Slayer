/**
 * MCP Tool: Metrics Fetcher
 *
 * Simulates infrastructure metrics for an SRE monitoring system.
 * Returns realistic CPU, disk, memory, and pod metrics with
 * configurable anomaly injection for demo/testing purposes.
 *
 * Endpoints:
 *   GET  /metrics          — Current infrastructure snapshot
 *   GET  /metrics/history  — Last N data points
 *   POST /metrics/anomaly  — Toggle anomaly mode for demos
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── Internal State ──────────────────────────────────────────
const metricsHistory = [];
const MAX_HISTORY = 100;
let anomalyMode = false;

// ── Helpers ────────────────────────────────────────────────

/**
 * Random float between min and max, rounded to precision decimal places.
 */
function randomBetween(min, max, precision = 1) {
  const value = Math.random() * (max - min) + min;
  return parseFloat(value.toFixed(precision));
}

/**
 * Generate a realistic infrastructure metrics snapshot.
 * Anomaly mode pushes values toward incident thresholds.
 */
function generateMetrics() {
  const now = new Date();

  const cpu = anomalyMode
    ? randomBetween(78, 99, 1)
    : randomBetween(15, 75, 1);

  const disk = anomalyMode
    ? randomBetween(85, 98, 1)
    : randomBetween(20, 70, 1);

  const memory = anomalyMode
    ? randomBetween(80, 96, 1)
    : randomBetween(30, 70, 1);

  const podsDesired = 5;
  const podsRunning = anomalyMode
    ? Math.max(1, Math.floor(Math.random() * 3))
    : Math.min(podsDesired, podsDesired - Math.floor(Math.random() * 2));

  const networkInMbps = randomBetween(10, 500, 0);
  const networkOutMbps = randomBetween(5, 300, 0);

  const requestsPerSecond = anomalyMode
    ? randomBetween(800, 2000, 0)
    : randomBetween(50, 400, 0);

  const errorRate = anomalyMode
    ? randomBetween(5, 25, 2)
    : randomBetween(0, 2, 2);

  const responseTimeMs = anomalyMode
    ? randomBetween(500, 5000, 0)
    : randomBetween(20, 200, 0);

  return {
    id: uuidv4(),
    timestamp: now.toISOString(),
    epoch_ms: now.getTime(),
    host: 'prod-k8s-node-01',
    cluster: 'us-east-1-primary',
    infrastructure: {
      cpu_percent: cpu,
      disk_percent: disk,
      memory_percent: memory,
      pods_running: podsRunning,
      pods_desired: podsDesired,
    },
    network: {
      ingress_mbps: networkInMbps,
      egress_mbps: networkOutMbps,
    },
    application: {
      requests_per_second: requestsPerSecond,
      error_rate_percent: errorRate,
      avg_response_time_ms: responseTimeMs,
    },
    anomaly_mode: anomalyMode,
  };
}

// ── Routes ─────────────────────────────────────────────────

/** GET /metrics — Current snapshot */
router.get('/metrics', (req, res) => {
  try {
    const metrics = generateMetrics();

    metricsHistory.push(metrics);
    if (metricsHistory.length > MAX_HISTORY) metricsHistory.shift();

    console.log(
      `[metrics-fetcher] CPU=${metrics.infrastructure.cpu_percent}% | ` +
      `Disk=${metrics.infrastructure.disk_percent}% | ` +
      `Pods=${metrics.infrastructure.pods_running}/${metrics.infrastructure.pods_desired}`
    );

    return res.json({ success: true, data: metrics });
  } catch (error) {
    console.error('[metrics-fetcher] Error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to generate metrics', details: error.message });
  }
});

/** GET /metrics/history — Recent snapshots */
router.get('/metrics/history', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), MAX_HISTORY);
    const records = metricsHistory.slice(-limit);
    console.log(`[metrics-fetcher] History: ${records.length} records`);
    return res.json({ success: true, count: records.length, data: records });
  } catch (error) {
    console.error('[metrics-fetcher] History error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch history', details: error.message });
  }
});

/** POST /metrics/anomaly — Toggle anomaly mode */
router.post('/metrics/anomaly', (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: '"enabled" must be a boolean' });
    }
    anomalyMode = enabled;
    console.log(`[metrics-fetcher] Anomaly mode ${anomalyMode ? 'ENABLED' : 'DISABLED'}`);
    return res.json({
      success: true,
      anomaly_mode: anomalyMode,
      message: anomalyMode
        ? 'Anomaly mode enabled — metrics will simulate incident conditions'
        : 'Anomaly mode disabled — metrics return to normal ranges',
    });
  } catch (error) {
    console.error('[metrics-fetcher] Anomaly toggle error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to toggle anomaly mode', details: error.message });
  }
});

module.exports = router;
module.exports.generateMetrics = generateMetrics;
module.exports._testInternals = {
  metricsHistory,
  setAnomalyMode: (v) => { anomalyMode = v; },
};
