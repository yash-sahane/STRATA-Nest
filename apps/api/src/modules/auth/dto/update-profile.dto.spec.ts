import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './index';

/** Mirrors the API's global pipe (apps/api/src/main.ts). */
const errorsFor = (payload: unknown) =>
  validateSync(plainToInstance(UpdateProfileDto, payload, { enableImplicitConversion: true }) as object, {
    whitelist: true,
  });

describe('UpdateProfileDto.avatar', () => {
  // What the settings page sends: FileReader.readAsDataURL of the picked image.
  it.each(['png', 'jpeg', 'jpg', 'gif', 'webp'])('accepts a %s data URI', (type) => {
    expect(errorsFor({ avatar: `data:image/${type};base64,iVBORw0KGgoAAAANSUhEUg==` })).toHaveLength(0);
  });

  it('accepts clearing it', () => {
    expect(errorsFor({ avatar: '' })).toHaveLength(0);
  });

  // Fetched by every colleague whose screen shows the avatar.
  it.each([
    'https://tracker.example/pixel.png?u=asha',
    '//tracker.example/pixel.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,PGgxPmhpPC9oMT4=',
    'data:image/png,not-base64',
    'data:image/png;base64,AAAA" onerror="alert(1)',
    'javascript:alert(1)',
  ])('refuses %p', (avatar) => {
    const [error] = errorsFor({ avatar });
    expect(error?.constraints).toHaveProperty('matches');
  });
});
