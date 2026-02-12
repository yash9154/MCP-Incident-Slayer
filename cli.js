#!/usr/bin/env node

/**
 * MCP Incident Slayer — CLI
 *
 * Command-line interface for interacting with the incident response system.
 *
 * Usage:
 *   node cli.js --local              Run a local health check against MCP tools
 *   node cli.js --query "message"    Send a query to the Archestra agent
 *   node cli.js --status             Show system status
 *   node cli.js --anomaly on|off     Toggle anomaly mode for demos
 */

'use strict';

require('dotenv').config();

const { Command } = require('commander');
const chalk = require('chalk');

const program = new Command();

const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 4000}`;
const ARCHESTRA_URL = process.env.ARCHESTRA_URL || 'http://localhost:9000';

// ── Helpers ────────────────────────────────────────────────

/**
 * Make an HTTP request using native fetch (Node 18+).
 */
async function request(url, options = {}) {
    try {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options,
        });
        const data = await response.json();
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        return { ok: false, status: 0, data: null, error: error.message };
    }
}

function printHeader(title) {
    console.log('');
    console.log(chalk.cyan.bold('╔════════════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold(`║  ⚔️  ${title.padEnd(42)}║`));
    console.log(chalk.cyan.bold('╚════════════════════════════════════════════════╝'));
    console.log('');
}

function printSection(title) {
    console.log(chalk.yellow.bold(`\n── ${title} ${'─'.repeat(Math.max(0, 44 - title.length))}`));
}

function severityColor(value, threshold, invert = false) {
    const isHigh = invert ? value < threshold : value > threshold;
    if (isHigh) return chalk.red.bold(value);
    if (invert ? value < threshold * 1.2 : value > threshold * 0.8) return chalk.yellow(value);
    return chalk.green(value);
}

// ── Commands ───────────────────────────────────────────────

/** Local health check — fetches from all MCP tools and prints a formatted report */
async function runLocalCheck() {
    printHeader('MCP INCIDENT SLAYER — SYSTEM CHECK');

    // 1. Health
    printSection('Server Health');
    const health = await request(`${SERVER_URL}/health`);
    if (!health.ok) {
        console.log(chalk.red(`  ✗ Server unreachable at ${SERVER_URL}`));
        console.log(chalk.red(`    Error: ${health.error || 'Connection refused'}`));
        console.log(chalk.dim(`    Hint: Start the server first with: npm start`));
        process.exit(1);
    }
    console.log(chalk.green(`  ✓ Server healthy | Uptime: ${health.data.uptime_seconds}s`));

    // 2. Metrics
    printSection('Infrastructure Metrics');
    const metrics = await request(`${SERVER_URL}/metrics`);
    if (metrics.ok && metrics.data.success) {
        const infra = metrics.data.data.infrastructure;
        const app = metrics.data.data.application;

        console.log(`  CPU:           ${severityColor(infra.cpu_percent, 80)}%`);
        console.log(`  Memory:        ${severityColor(infra.memory_percent, 85)}%`);
        console.log(`  Disk:          ${severityColor(infra.disk_percent, 90)}%`);
        console.log(`  Pods:          ${severityColor(infra.pods_running, infra.pods_desired, true)} / ${infra.pods_desired}`);
        console.log(`  Error Rate:    ${severityColor(app.error_rate_percent, 5)}%`);
        console.log(`  Resp Time:     ${severityColor(app.avg_response_time_ms, 2000)}ms`);
        console.log(`  Requests/sec:  ${app.requests_per_second}`);
        console.log(`  Anomaly Mode:  ${metrics.data.data.anomaly_mode ? chalk.red.bold('ON') : chalk.green('OFF')}`);

        // Incident detection
        const incidents = [];
        if (infra.cpu_percent > 80) incidents.push({ type: 'HIGH CPU', severity: 'critical' });
        if (infra.disk_percent > 90) incidents.push({ type: 'DISK PRESSURE', severity: 'critical' });
        if (infra.memory_percent > 85) incidents.push({ type: 'MEMORY PRESSURE', severity: 'warning' });
        if (infra.pods_running < infra.pods_desired) incidents.push({ type: 'POD CRASH', severity: 'critical' });
        if (app.error_rate_percent > 5) incidents.push({ type: 'HIGH ERROR RATE', severity: 'warning' });
        if (app.avg_response_time_ms > 2000) incidents.push({ type: 'HIGH LATENCY', severity: 'warning' });

        if (incidents.length > 0) {
            printSection('⚠️  INCIDENTS DETECTED');
            for (const inc of incidents) {
                const icon = inc.severity === 'critical' ? '🔴' : '🟡';
                console.log(`  ${icon} ${chalk.bold(inc.type)} [${inc.severity.toUpperCase()}]`);
            }
        } else {
            printSection('Status');
            console.log(chalk.green.bold('  ✓ All systems nominal. No incidents detected.'));
        }
    } else {
        console.log(chalk.red('  ✗ Failed to fetch metrics'));
    }

    // 3. Recent Logs
    printSection('Recent Error Logs');
    const logs = await request(`${SERVER_URL}/logs?level=error&limit=5`);
    if (logs.ok && logs.data.success && logs.data.data.length > 0) {
        for (const log of logs.data.data) {
            const time = new Date(log.timestamp).toLocaleTimeString();
            console.log(`  ${chalk.dim(time)} ${chalk.red(`[${log.level.toUpperCase()}]`)} ${chalk.cyan(log.service)} ${log.message.substring(0, 70)}`);
        }
    } else {
        console.log(chalk.green('  ✓ No recent errors'));
    }

    // 4. Remediation History
    printSection('Recent Remediation Actions');
    const history = await request(`${SERVER_URL}/history?limit=5`);
    if (history.ok && history.data.success && history.data.data.length > 0) {
        for (const action of history.data.data) {
            const time = new Date(action.timestamp).toLocaleTimeString();
            const statusIcon = action.status === 'success' ? chalk.green('✓') : chalk.red('✗');
            console.log(`  ${statusIcon} ${chalk.dim(time)} ${chalk.bold(action.action)} [${action.status}] ${action.duration_ms}ms`);
        }
    } else {
        console.log(chalk.dim('  No recent actions'));
    }

    console.log('');
}

/** Query the Archestra agent */
async function runQuery(query) {
    printHeader('MCP INCIDENT SLAYER — AGENT QUERY');

    console.log(chalk.dim(`  Sending to Archestra at ${ARCHESTRA_URL}...`));
    console.log(chalk.dim(`  Query: "${query}"`));
    console.log('');

    const result = await request(`${ARCHESTRA_URL}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({
            message: query,
            agent: 'IncidentSlayer',
        }),
    });

    if (result.ok && result.data) {
        printSection('Agent Response');
        console.log(chalk.white(JSON.stringify(result.data, null, 2)));
    } else {
        console.log(chalk.yellow('  ⚠ Could not reach Archestra agent.'));
        console.log(chalk.dim(`    Error: ${result.error || `HTTP ${result.status}`}`));
        console.log(chalk.dim('    Make sure Archestra is running: docker run archestra/platform'));
        console.log('');
        console.log(chalk.cyan('  💡 Try a local check instead:'));
        console.log(chalk.cyan('     node cli.js --local'));
    }

    console.log('');
}

/** Show system status */
async function showStatus() {
    printHeader('MCP INCIDENT SLAYER — SYSTEM STATUS');

    const status = await request(`${SERVER_URL}/status`);
    if (status.ok && status.data.success) {
        const d = status.data.data;
        console.log(`  Service:    ${chalk.bold(d.service)}`);
        console.log(`  Version:    ${d.version}`);
        console.log(`  Uptime:     ${d.uptime_seconds}s`);
        console.log(`  Memory:     ${d.memory.heap_used_mb}MB / ${d.memory.heap_total_mb}MB (heap)`);
        console.log(`  Database:   ${d.database.path}`);
        console.log(`  Tools:      ${d.tools.join(', ')}`);
        printSection('Available Endpoints');
        for (const [name, endpoint] of Object.entries(d.endpoints)) {
            console.log(`  ${chalk.dim(name.padEnd(20))} ${endpoint}`);
        }
    } else {
        console.log(chalk.red(`  ✗ Server unreachable at ${SERVER_URL}`));
        console.log(chalk.dim(`    Start with: npm start`));
    }

    console.log('');
}

/** Toggle anomaly mode */
async function toggleAnomaly(mode) {
    const enabled = mode === 'on';
    const result = await request(`${SERVER_URL}/metrics/anomaly`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
    });

    if (result.ok && result.data.success) {
        console.log(enabled
            ? chalk.red.bold('\n  🔴 Anomaly mode ENABLED — metrics will simulate incident conditions\n')
            : chalk.green.bold('\n  🟢 Anomaly mode DISABLED — metrics return to normal\n')
        );
    } else {
        console.log(chalk.red(`\n  ✗ Failed to toggle anomaly mode: ${result.error || 'unknown error'}\n`));
    }
}

// ── CLI Definition ─────────────────────────────────────────

program
    .name('incident-slayer')
    .description('⚔️  MCP Incident Slayer — AI SRE Incident Responder CLI')
    .version('1.0.0');

program
    .option('-l, --local', 'Run a local health check against all MCP tools')
    .option('-q, --query <message>', 'Send a query to the Archestra agent')
    .option('-s, --status', 'Show system status')
    .option('-a, --anomaly <on|off>', 'Toggle anomaly mode for demos');

program.parse(process.argv);

const opts = program.opts();

(async () => {
    try {
        if (opts.local) {
            await runLocalCheck();
        } else if (opts.query) {
            await runQuery(opts.query);
        } else if (opts.status) {
            await showStatus();
        } else if (opts.anomaly) {
            if (opts.anomaly !== 'on' && opts.anomaly !== 'off') {
                console.log(chalk.red('\n  Error: --anomaly must be "on" or "off"\n'));
                process.exit(1);
            }
            await toggleAnomaly(opts.anomaly);
        } else {
            program.help();
        }
    } catch (error) {
        console.error(chalk.red(`\n  Fatal error: ${error.message}\n`));
        process.exit(1);
    }
})();
