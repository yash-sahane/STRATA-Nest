/**
 * Minimal, dependency-free factory helper. Domain factories (User, Workspace, …)
 * are defined alongside their modules using this.
 *
 * Usage (in a module's tests):
 *   const userFactory = defineFactory<User>((seq) => ({
 *     id: generateId(), email: `user${seq}@example.test`, name: `User ${seq}`, ...
 *   }));
 *   const u = userFactory({ role: 'MANAGER' }); // overrides merge over defaults
 */
export type Factory<T> = ((overrides?: Partial<T>) => T) & { reset(): void };

export function defineFactory<T>(build: (seq: number) => T): Factory<T> {
  let seq = 0;
  const factory = ((overrides?: Partial<T>): T => {
    seq += 1;
    return { ...build(seq), ...(overrides ?? {}) };
  }) as Factory<T>;
  factory.reset = () => {
    seq = 0;
  };
  return factory;
}
