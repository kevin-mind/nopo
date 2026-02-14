export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends infer TP
    ? TP extends (infer U)[]
      ? DeepPartial<U>[]
      : TP extends ReadonlyArray<infer U>
        ? ReadonlyArray<DeepPartial<U>>
        : DeepPartial<T[P]>
    : T[P];
};

type Primitive =
  | string
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- needed for type-level check
  | Function
  | number
  | boolean
  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types -- needed for type-level check
  | Symbol
  | undefined
  | null;

export type DeepOmitOptional<T> = T extends Primitive
  ? T
  : {
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional: {} extends Pick<T,K> tests whether K is optional
      [K in keyof T]: {} extends Pick<T, K>
        ? never
        : T[K] extends infer TK
          ? TK extends (infer U)[]
            ? DeepOmitOptional<U>[]
            : TK extends ReadonlyArray<infer U>
              ? ReadonlyArray<DeepOmitOptional<U>>
              : DeepOmitOptional<TK>
          : T[K];
    };

export type Thunk<T, A = never> = ((arg: A) => T) | T;

export interface MockFactory<T> {
  (input?: DeepPartial<T>): T;
  extend(partial: DeepPartial<T>): MockFactory<T>;
}
