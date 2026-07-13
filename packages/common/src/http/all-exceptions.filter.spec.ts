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
