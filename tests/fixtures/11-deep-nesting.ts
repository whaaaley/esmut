// A site twelve blocks down, which makes the full ancestor chain the expensive tier rather than the cheap one.
// Nothing here is ambiguous, so this measures the cost of depth rather than the difficulty of disambiguation.

export const descend = (depth: number): string => {
  if (depth > 0) {
    if (depth > 1) {
      if (depth > 2) {
        if (depth > 3) {
          if (depth > 4) {
            if (depth > 5) {
              if (depth > 6) {
                if (depth > 7) {
                  if (depth > 8) {
                    if (depth > 9) {
                      return 'the floor'
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return 'shallow'
}
