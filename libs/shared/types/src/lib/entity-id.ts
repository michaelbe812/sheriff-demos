/** Dumb shared types. type:types imports nothing but type:types. */
export type Branded<T, B extends string> = T & { readonly __brand: B };
