import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTaskDto, UpdateTaskCommentDto, UpdateTaskDto } from './index';

/** Mirrors the API's global pipe (apps/api/src/main.ts): transform, implicit conversion, whitelist. */
function parse<T extends object>(cls: new () => T, payload: unknown) {
  const instance = plainToInstance(cls, payload, { enableImplicitConversion: true });
  const errors = validateSync(instance, { whitelist: true });
  return { instance, failed: errors.map((error) => error.property) };
}

const task = { workspaceId: 'w1', projectId: 'p1', title: 'Ship it' };

describe('task labels', () => {
  // One `[42]` stored by any client crashed every board for everybody: each of
  // them reads a label with `.split`.
  it.each([[42], [{ color: 'red' }], [null], [['nested']]])('refuses %p as a label', (label) => {
    expect(parse(CreateTaskDto, { ...task, labels: [label] }).failed).toContain('labels');
    expect(parse(UpdateTaskDto, { labels: ['blue:API', label] }).failed).toContain('labels');
  });

  it('refuses a label over 100 characters', () => {
    expect(parse(UpdateTaskDto, { labels: [`red:${'x'.repeat(97)}`] }).failed).toContain('labels');
    expect(parse(UpdateTaskDto, { labels: [`red:${'x'.repeat(96)}`] }).failed).toEqual([]);
  });

  it('takes ordinary labels, and none', () => {
    expect(parse(CreateTaskDto, { ...task, labels: ['blue:API', 'Backend'] }).failed).toEqual([]);
    expect(parse(UpdateTaskDto, { labels: [] }).failed).toEqual([]);
    expect(parse(UpdateTaskDto, {}).failed).toEqual([]);
  });
});

describe('editing a comment is held to the rules for posting one', () => {
  it.each(['', '   ', '​'])('refuses blank content %p', (content) => {
    expect(parse(UpdateTaskCommentDto, { content }).failed).toContain('content');
  });

  it('refuses content over 10,000 characters', () => {
    expect(parse(UpdateTaskCommentDto, { content: 'x'.repeat(10_001) }).failed).toContain('content');
  });

  it('refuses a non-string instead of storing "[object Object]"', () => {
    expect(parse(UpdateTaskCommentDto, { content: { text: 'hi' } }).failed).toContain('content');
  });

  it('trims what it keeps, and leaves content out when it is not being edited', () => {
    expect(parse(UpdateTaskCommentDto, { content: '  fixed  ' }).instance.content).toBe('fixed');
    expect(parse(UpdateTaskCommentDto, { mentions: ['u2'] }).failed).toEqual([]);
  });
});

describe('placing a dropped card', () => {
  it("takes the card it lands in front of, or '' for the bottom", () => {
    expect(parse(UpdateTaskDto, { placeBefore: 't2' }).instance.placeBefore).toBe('t2');
    expect(parse(UpdateTaskDto, { placeBefore: '' }).failed).toEqual([]);
  });
});
