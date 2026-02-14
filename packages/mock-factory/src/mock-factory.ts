/* eslint-disable @typescript-eslint/consistent-type-assertions -- generic deep-merge utility requires type assertions */
import type {
  DeepPartial,
  DeepOmitOptional,
  MockFactory,
  Thunk,
} from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(deepClone) as T;
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = deepClone(value[key]);
    }
    return result as T;
  }
  return value;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (Array.isArray(sourceVal) && Array.isArray(targetVal)) {
      if (sourceVal.length === 0) {
        result[key] = [];
      } else {
        const merged = [...targetVal] as unknown[];
        for (let i = 0; i < sourceVal.length; i++) {
          if (
            i < merged.length &&
            isPlainObject(sourceVal[i]) &&
            isPlainObject(merged[i])
          ) {
            merged[i] = deepMerge(
              merged[i] as Record<string, unknown>,
              sourceVal[i] as Record<string, unknown>,
            );
          } else {
            merged[i] = deepClone(sourceVal[i]);
          }
        }
        result[key] = merged;
      }
    } else if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

function getDefaultValues<T, A>(defaults: Thunk<T, A>, arg?: A): T {
  if (typeof defaults === "function") {
    return (defaults as (a: A) => T)(arg as A);
  }
  return defaults;
}

export function createMockFactory<T>(
  defaults: Thunk<DeepOmitOptional<T>>,
): MockFactory<T> {
  function createMock(input?: DeepPartial<T>): T {
    const base = getDefaultValues(defaults);
    const cloned = deepClone(base);

    if (!input) return cloned as T;

    if (isPlainObject(cloned) && isPlainObject(input)) {
      return deepMerge(cloned, input as Record<string, unknown>) as T;
    }

    return cloned as T;
  }

  createMock.extend = function extend(partial: DeepPartial<T>): MockFactory<T> {
    const thunk = (): DeepOmitOptional<T> => {
      const base = createMock();
      if (isPlainObject(base) && isPlainObject(partial)) {
        return deepMerge(
          deepClone(base) as Record<string, unknown>,
          partial as Record<string, unknown>,
        ) as DeepOmitOptional<T>;
      }
      return base as DeepOmitOptional<T>;
    };
    return createMockFactory<T>(thunk);
  };

  return createMock as MockFactory<T>;
}
