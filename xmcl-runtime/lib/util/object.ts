export function assignShallow(state: Record<string, any>, options: Record<string, any>) {
  const primitive = new Set(['string', 'number', 'boolean'])
  for (const key of Object.keys(state)) {
    if (primitive.has(typeof state[key]) &&
      typeof options[key] === typeof state[key]) {
      state[key] = options[key]
    } else if (state[key] instanceof Array &&
      options[key] instanceof Array) {
      state[key] = options[key]
    }
  }
}
export function requireObject(object: unknown, message?: string): asserts object is object {
  if (typeof object !== 'object') throw new Error(message || 'Require a object!')
}
export function requireString(object: unknown, message?: any): asserts object is string {
  if (typeof object !== 'string') throw new Error(message || `Require a string! But get ${typeof object} ${JSON.stringify(object)}`)
}

export function compareDate(a: Date, b: Date) {
  // @ts-ignore
  return a - b
}

export function toRecord<T, K extends string | symbol | number >(array: T[], key: (v: T) => K) {
  const result: Record<K, T> = {} as any
  for (const i of array) {
    result[key(i)] = i
  }
  return result
}
export function isNonnull<T>(object: T | undefined | null): object is T {
  return object !== undefined && object !== null
}
export function requireNonnull(object: unknown, message?: any): asserts object {
  if (typeof object === 'undefined' || object === null) throw new Error(message || 'Require object existed!')
}
