/**
 * Tests: Metrics Fetcher MCP Tool
 */

'use strict';

const request = require('supertest');
const app = require('../server');

describe('MCP Tool: metrics-fetcher', () => {
    describe('GET /metrics', () => {
        it('should return a valid metrics snapshot', async () => {
            const res = await request(app).get('/metrics');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();

            const { data } = res.body;
            expect(data.id).toBeDefined();
            expect(data.timestamp).toBeDefined();
            expect(data.host).toBe('prod-k8s-node-01');
            expect(data.cluster).toBe('us-east-1-primary');
        });

        it('should return infrastructure metrics within valid ranges', async () => {
            const res = await request(app).get('/metrics');
            const infra = res.body.data.infrastructure;

            expect(infra.cpu_percent).toBeGreaterThanOrEqual(0);
            expect(infra.cpu_percent).toBeLessThanOrEqual(100);
            expect(infra.disk_percent).toBeGreaterThanOrEqual(0);
            expect(infra.disk_percent).toBeLessThanOrEqual(100);
            expect(infra.memory_percent).toBeGreaterThanOrEqual(0);
            expect(infra.memory_percent).toBeLessThanOrEqual(100);
            expect(infra.pods_running).toBeGreaterThanOrEqual(1);
            expect(infra.pods_running).toBeLessThanOrEqual(infra.pods_desired);
        });

        it('should include application metrics', async () => {
            const res = await request(app).get('/metrics');
            const app_metrics = res.body.data.application;

            expect(app_metrics.requests_per_second).toBeDefined();
            expect(app_metrics.error_rate_percent).toBeDefined();
            expect(app_metrics.avg_response_time_ms).toBeDefined();
        });

        it('should include network metrics', async () => {
            const res = await request(app).get('/metrics');
            const net = res.body.data.network;

            expect(net.ingress_mbps).toBeGreaterThanOrEqual(0);
            expect(net.egress_mbps).toBeGreaterThanOrEqual(0);
        });

        it('should produce variance across multiple calls', async () => {
            const res1 = await request(app).get('/metrics');
            const res2 = await request(app).get('/metrics');

            // IDs should be unique
            expect(res1.body.data.id).not.toBe(res2.body.data.id);
        });
    });

    describe('GET /metrics/history', () => {
        it('should return metrics history', async () => {
            // Generate a few data points first
            await request(app).get('/metrics');
            await request(app).get('/metrics');

            const res = await request(app).get('/metrics/history?limit=5');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBeGreaterThanOrEqual(1);
            expect(res.body.data.length).toBeLessThanOrEqual(5);
        });
    });

    describe('POST /metrics/anomaly', () => {
        it('should enable anomaly mode', async () => {
            const res = await request(app)
                .post('/metrics/anomaly')
                .send({ enabled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.anomaly_mode).toBe(true);
        });

        it('should disable anomaly mode', async () => {
            const res = await request(app)
                .post('/metrics/anomaly')
                .send({ enabled: false });

            expect(res.status).toBe(200);
            expect(res.body.anomaly_mode).toBe(false);
        });

        it('should reject non-boolean enabled value', async () => {
            const res = await request(app)
                .post('/metrics/anomaly')
                .send({ enabled: 'yes' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should produce high metrics when anomaly mode is on', async () => {
            await request(app).post('/metrics/anomaly').send({ enabled: true });
            const res = await request(app).get('/metrics');

            // In anomaly mode, CPU should trend high
            expect(res.body.data.infrastructure.cpu_percent).toBeGreaterThanOrEqual(70);

            // Clean up
            await request(app).post('/metrics/anomaly').send({ enabled: false });
        });
    });
});
