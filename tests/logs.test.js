/**
 * Tests: Logs Database MCP Tool
 */

'use strict';

const request = require('supertest');
const app = require('../server');

describe('MCP Tool: logs-db', () => {
    describe('GET /logs', () => {
        it('should return seeded log entries', async () => {
            const res = await request(app).get('/logs');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBeGreaterThan(0);
        });

        it('should return logs with correct shape', async () => {
            const res = await request(app).get('/logs?limit=1');
            const log = res.body.data[0];

            expect(log.id).toBeDefined();
            expect(log.timestamp).toBeDefined();
            expect(log.level).toBeDefined();
            expect(log.service).toBeDefined();
            expect(log.message).toBeDefined();
            expect(log.metadata).toBeDefined();
        });

        it('should filter logs by level', async () => {
            const res = await request(app).get('/logs?level=error');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            for (const log of res.body.data) {
                expect(log.level).toBe('error');
            }
        });

        it('should filter logs by service', async () => {
            const res = await request(app).get('/logs?service=api-gateway');

            expect(res.status).toBe(200);
            for (const log of res.body.data) {
                expect(log.service).toBe('api-gateway');
            }
        });

        it('should support search in message', async () => {
            const res = await request(app).get('/logs?search=timeout');

            expect(res.status).toBe(200);
            for (const log of res.body.data) {
                expect(log.message.toLowerCase()).toContain('timeout');
            }
        });

        it('should respect limit parameter', async () => {
            const res = await request(app).get('/logs?limit=3');

            expect(res.status).toBe(200);
            expect(res.body.data.length).toBeLessThanOrEqual(3);
        });

        it('should reject invalid level', async () => {
            const res = await request(app).get('/logs?level=invalid');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe('POST /logs', () => {
        it('should insert a new log entry', async () => {
            const res = await request(app)
                .post('/logs')
                .send({
                    level: 'info',
                    service: 'test-service',
                    message: 'Test log entry from Jest',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBeDefined();
            expect(res.body.data.level).toBe('info');
            expect(res.body.data.service).toBe('test-service');
        });

        it('should reject log with missing fields', async () => {
            const res = await request(app)
                .post('/logs')
                .send({ level: 'info' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should reject invalid log level', async () => {
            const res = await request(app)
                .post('/logs')
                .send({ level: 'invalid', service: 'test', message: 'test' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe('GET /logs/stats', () => {
        it('should return log statistics', async () => {
            const res = await request(app).get('/logs/stats');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.total).toBeGreaterThan(0);
            expect(Array.isArray(res.body.data.by_level)).toBe(true);
            expect(Array.isArray(res.body.data.by_service)).toBe(true);
        });
    });
});
