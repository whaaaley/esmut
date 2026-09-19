// The same object literal at three depths of one expression, so depth is the only thing telling the copies apart.
// A descendant combinator matches at every depth, which means only a child chain or a bait above narrows it to one.

export const defaults = {
  retry: { attempts: 2, backoff: 100 },
  nested: {
    retry: { attempts: 2, backoff: 100 },
    inner: {
      retry: { attempts: 2, backoff: 100 },
    },
  },
}
