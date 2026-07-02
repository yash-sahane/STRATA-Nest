/**
 * Fluent builder base for constructing complex test entities step by step.
 * Concrete builders (e.g. TaskBuilder) extend this in their module's tests.
 */
export abstract class Builder<T> {
  protected readonly value: Partial<T> = {};

  with<K extends keyof T>(key: K, val: T[K]): this {
    this.value[key] = val;
    return this;
  }

  merge(partial: Partial<T>): this {
    Object.assign(this.value, partial);
    return this;
  }

  abstract build(): T;
}
