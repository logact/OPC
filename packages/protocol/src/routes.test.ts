import { describe, expect, it } from 'vitest';
import { API_ROUTES } from './routes.js';

describe('API_ROUTES', () => {
  it('provides room collection route', () => {
    expect(API_ROUTES.rooms).toBe('/api/v1/rooms');
  });

  it('builds single room route', () => {
    expect(API_ROUTES.room('room-1')).toBe('/api/v1/rooms/room-1');
  });

  it('builds room history route', () => {
    expect(API_ROUTES.roomHistory('room-1')).toBe('/api/v1/rooms/room-1/history');
  });

  it('provides websocket route', () => {
    expect(API_ROUTES.ws).toBe('/ws/v1');
  });
});
