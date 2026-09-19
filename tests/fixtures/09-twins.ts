// The shape that scored worst in the measurements: two functions token-identical inside, named only by their binding.
// The enclosing declarator is the sole discriminator, so every site here needs a named scope above it to resolve.

type Result<T> = { data: T; error: null } | { data: null; error: Error }

export const attempt = <T>(fn: () => T): Result<T> => {
  try {
    return { data: fn(), error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

export const attemptAsync = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try {
    return { data: await fn(), error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) }
  }
}
