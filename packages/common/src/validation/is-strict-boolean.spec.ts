import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, validateSync } from 'class-validator';
import { IsStrictBoolean } from './is-strict-boolean';

class Dto {
  @IsOptional() @IsStrictBoolean() @IsBoolean() archived?: boolean;
}

/** Mirrors the API's global pipe (apps/api/src/main.ts), which is what breaks a bare @IsBoolean(). */
const parse = (payload: unknown) => {
  const instance = plainToInstance(Dto, payload, { enableImplicitConversion: true });
  return { instance, errors: validateSync(instance as object, { whitelist: true }) };
};

describe('IsStrictBoolean', () => {
  it('keeps real booleans intact', () => {
    expect(parse({ archived: true }).instance.archived).toBe(true);
    expect(parse({ archived: false }).instance.archived).toBe(false);
  });

  it("maps the string 'false' to false — implicit conversion turned it into true", () => {
    const { instance, errors } = parse({ archived: 'false' });
    expect(errors).toHaveLength(0);
    expect(instance.archived).toBe(false);
  });

  it("maps the string 'true' to true", () => {
    expect(parse({ archived: 'true' }).instance.archived).toBe(true);
  });

  it('accepts the 1/0 spellings used by form encodings', () => {
    expect(parse({ archived: 1 }).instance.archived).toBe(true);
    expect(parse({ archived: 0 }).instance.archived).toBe(false);
    expect(parse({ archived: '1' }).instance.archived).toBe(true);
    expect(parse({ archived: '0' }).instance.archived).toBe(false);
  });

  it.each(['yes', 'no', 'off', 'banana', ''])('rejects %p instead of silently storing true', (raw) => {
    expect(parse({ archived: raw }).errors.length).toBeGreaterThan(0);
  });

  it('leaves an absent field absent, so @IsOptional still applies', () => {
    const { instance, errors } = parse({});
    expect(errors).toHaveLength(0);
    expect(instance.archived).toBeUndefined();
  });
});
