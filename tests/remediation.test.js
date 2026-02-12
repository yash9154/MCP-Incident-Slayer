/**
 * Tests: Remediation Executor MCP Tool
 */

'use strict';

const request = require('supertest');
const app = require('../server');

describe('MCP Tool: remediation-executor', () => {
    describe('POST /execute — Allowed Actions', () => {
        it('should execute scale_pods successfully', async () => {
            const res = await request(app)
                .post('/execute')
                .send({
                    action: 'scale_pods',
                    params: { service: 'payment-service', replicas: 5 },
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.execution_id).toBeDefined();
            expect(res.body.action).toBe('scale_pods');
            expect(res.body.result.message).toContain('Scaled');
            expect(res.body.result.new_replicas).toBe(5);
        });

        it('should execute restart_service successfully', async () => {
            const res = await request(app)
                .post('/execute')
                .send({
                    action: 'restart_service',
                    params: { service: 'api-gateway' },
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result.message).toContain('restart');
        });

        it('should execute notify_slack successfully', async () => {
            const res = await request(app)
                .post('/execute')
                .send({
                    action: 'notify_slack',
                    params: {
                        channel: '#incidents',
                        message: 'Test notification from Jest',
                    },
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result.delivered).toBe(true);
        });
    });

    describe('POST /execute — Policy Rejections', () => {
        it('should reject disallowed actions with 403', async () => {
            const res = await request(app)
                .post('/execute')
                .send({
                    action: 'delete_all',
                    params: {},
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toContain('not permitted');
            expect(res.body.allowed_actions).toEqual(
                expect.arrayContaining(['scale_pods', 'restart_service', 'notify_slack'])
            );
        });

        it('should reject reboot_server', async () => {
            const res = await request(app)
                .post('/execute')
                .send({ action: 'reboot_server', params: { server: 'prod-01' } });

            expect(res.status).toBe(403);
        });

        it('should reject terminate_instance', async () => {
            const res = await request(app)
                .post('/execute')
                .send({ action: 'terminate_instance', params: { id: 'i-12345' } });

            expect(res.status).toBe(403);
        });
    });

    describe('POST /execute — Validation', () => {
        it('should reject missing action field', async () => {
            const res = await request(app)
                .post('/execute')
                .send({ params: {} });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should reject missing params field', async () => {
            const res = await request(app)
                .post('/execute')
                .send({ action: 'scale_pods' });

            expect(res.status).toBe(400);
        });

        it('should reject scale_pods with invalid replicas', async () => {
            const res = await request(app)
                .post('/execute')
                .send({
                    action: 'scale_pods',
                    params: { service: 'test', replicas: 100 },
                });

            expect(res.status).toBe(400);
            expect(res.body.validation_errors).toBeDefined();
        });

        it('should reject scale_pods with missing service', async () => {
            const res = await request(app)
                .post('/execute')
                .send({
                    action: 'scale_pods',
                    params: { replicas: 3 },
                });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /history', () => {
        it('should return execution history', async () => {
            const res = await request(app).get('/history');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
        });

        it('should filter history by status', async () => {
            const res = await request(app).get('/history?status=success');

            expect(res.status).toBe(200);
            for (const entry of res.body.data) {
                expect(entry.status).toBe('success');
            }
        });

        it('should reject invalid status filter', async () => {
            const res = await request(app).get('/history?status=invalid');

            expect(res.status).toBe(400);
        });
    });

    describe('GET /actions', () => {
        it('should return the list of allowed actions', async () => {
            const res = await request(app).get('/actions');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(3);

            const names = res.body.data.map((a) => a.name);
            expect(names).toContain('scale_pods');
            expect(names).toContain('restart_service');
            expect(names).toContain('notify_slack');
        });
    });
});
