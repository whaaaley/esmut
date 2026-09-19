// The motivating case: guards, status codes, and headers, where a surviving mutation is a real gap in a suite.
// Several literals repeat across branches without being structural twins, so an attribute alone rarely settles them.

type Request = { method: string; token: string | null; body: string }
type Response = { status: number; headers: Record<string, string>; body: string }

const JSON_TYPE = 'application/json'

export const handle = (request: Request): Response => {
  if (request.method !== 'POST') {
    return { status: 405, headers: { 'content-type': JSON_TYPE }, body: '{"error":"method"}' }
  }

  if (!request.token) {
    return { status: 401, headers: { 'content-type': JSON_TYPE }, body: '{"error":"token"}' }
  }

  if (request.body.length > 4096) {
    return { status: 413, headers: { 'content-type': JSON_TYPE }, body: '{"error":"size"}' }
  }

  return { status: 200, headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store' }, body: request.body }
}
