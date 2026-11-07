import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostWith(res: { status: jest.Mock; json: jest.Mock }): ArgumentsHost {
  return { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
}

function mockRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

/** Minimal stand-in — real Prisma errors aren't constructible without a client. */
class FakePrismaKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super('prisma error');
    this.code = code;
    Object.defineProperty(this, 'constructor', {
      value: { name: 'PrismaClientKnownRequestError' },
    });
  }
}

describe('AllExceptionsFilter — Prisma error mapping (RC finding)', () => {
  const filter = new AllExceptionsFilter();

  it('maps P2002 (unique constraint) to 400, not a raw 500', () => {
    const res = mockRes();
    filter.catch(new FakePrismaKnownRequestError('P2002'), hostWith(res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 400 }) }),
    );
  });

  it('maps P2003 (FK violation) to 400', () => {
    const res = mockRes();
    filter.catch(new FakePrismaKnownRequestError('P2003'), hostWith(res));
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('maps P2025 (record not found) to 404', () => {
    const res = mockRes();
    filter.catch(new FakePrismaKnownRequestError('P2025'), hostWith(res));
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('never leaks the raw Prisma message (column/table names)', () => {
    const res = mockRes();
    const err = new FakePrismaKnownRequestError('P2002');
    err.message = 'Unique constraint failed on the fields: (`workspace_id`,`date`,`name`)';
    filter.catch(err, hostWith(res));
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('workspace_id');
  });

  it('still falls back to a generic 500 for a truly unknown error', () => {
    const res = mockRes();
    filter.catch(new Error('boom'), hostWith(res));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

/**
 * Measured on the running stack: with Postgres stopped, a list route answered
 * 500 "Internal server error" (Prisma P1017, "Server has closed the
 * connection"). An outage is not a fault in the request, and it ends — the
 * client is owed a 503 and a Retry-After it already knows how to wait on.
 */
describe('AllExceptionsFilter — a backing service that is down', () => {
  const filter = new AllExceptionsFilter();
  const resWithHeaders = () => {
    const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  };
  const named = (name: string, message: string, code?: string) => {
    const err = new Error(message) as Error & { code?: string };
    if (code) err.code = code;
    Object.defineProperty(err, 'constructor', { value: { name } });
    return err;
  };

  it.each([
    ['Prisma: the server closed the connection (P1017)', named('PrismaClientKnownRequestError', 'Server has closed the connection.', 'P1017')],
    ['Prisma: cannot reach the database (P1001)', named('PrismaClientKnownRequestError', "Can't reach database server", 'P1001')],
    ['Prisma: no pooled connection in time (P2024)', named('PrismaClientKnownRequestError', 'Timed out fetching a new connection', 'P2024')],
    ['Prisma: could not initialise', named('PrismaClientInitializationError', "Can't reach database server")],
    ['Redis: a command outlived commandTimeout', new Error('Command timed out')],
    ['Redis: out of retries', named('MaxRetriesPerRequestError', 'Reached the max retries per request limit')],
    ['Redis: the connection has gone', new Error('Connection is closed.')],
  ])('%s -> 503 with Retry-After', (_label, err) => {
    const res = resWithHeaders();
    filter.catch(err, hostWith(res as never));
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    const body = res.json.mock.calls[0][0];
    expect(body.error).toMatchObject({ code: 503, type: 'ServiceUnavailable' });
    // No internals: the message is ours, not the driver's.
    expect(JSON.stringify(body)).not.toMatch(/Prisma|database server|max retries/i);
  });

  it('leaves a request error from Prisma alone (P2002 is still a 400)', () => {
    const res = resWithHeaders();
    filter.catch(named('PrismaClientKnownRequestError', 'Unique constraint failed', 'P2002'), hostWith(res as never));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
