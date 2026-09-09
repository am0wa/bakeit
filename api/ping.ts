/**
 * Throwaway probe: confirms Vercel picks up a root-level `api/` directory for this
 * static Astro project, before anything is built on top of that assumption.
 * Expect `{"ok":true}` at https://<preview>/api/ping. Delete once verified.
 */
export default function handler(request: Request): Response {
  return new Response(
    JSON.stringify({ ok: true, method: request.method, at: new Date().toISOString() }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}
