// A file the type checker erases entirely, so every node is a type kind and no op applies to any of them.
// Zero sites is the correct answer here, not a failure to address them.

export type Identifier = string

export interface Envelope<T> {
  id: Identifier
  payload: T
}

export type Handler<T> = (envelope: Envelope<T>) => void
