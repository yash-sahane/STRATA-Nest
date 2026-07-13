import { HierarchyIdService } from './hierarchy-id.service';

const H = new HierarchyIdService();

describe('HierarchyIdService', () => {
  it('extractChars strips non-letters, takes N, uppercases', () => {
    expect(H.extractChars('User Auth 2!', 3)).toBe('USE');
    expect(H.extractChars('a1b2c3', 3)).toBe('ABC');
    expect(H.extractChars('', 3)).toBe('');
    expect(H.extractChars('12 34', 3)).toBe('');
  });

  it('pad2 zero-pads to two digits, passes through larger', () => {
    expect(H.pad2(1)).toBe('01');
    expect(H.pad2(9)).toBe('09');
    expect(H.pad2(10)).toBe('10');
    expect(H.pad2(100)).toBe('100');
  });

  it('classifyFrType: explicit TECHNICAL wins, else keyword scan', () => {
    expect(H.classifyFrType({ type: 'technical' })).toBe('TECHNICAL');
    expect(H.classifyFrType({ title: 'Build the API endpoint' })).toBe('TECHNICAL');
    expect(H.classifyFrType({ description: 'needs database migration' })).toBe('TECHNICAL');
    expect(H.classifyFrType({ title: 'Update the welcome banner' })).toBe('FUNCTIONAL');
    expect(H.classifyFrType({})).toBe('FUNCTIONAL');
  });
});
