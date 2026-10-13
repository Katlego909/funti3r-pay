import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { WORKER_ID } from './helpers.js';

// Routes that were open to any signed-in user and that nothing used. They stay gone: a request must not reach any handler.
describe('removed routes', () => {
  it('POST /wallets/enterprise no longer exists', async () => {
    const res = await request(app)
      .post('/wallets/enterprise')
      .set({ 'x-user-id': WORKER_ID, 'x-user-role': 'worker' })
      .send({ userId: WORKER_ID });
    expect(res.status).toBe(404);
  });
});
