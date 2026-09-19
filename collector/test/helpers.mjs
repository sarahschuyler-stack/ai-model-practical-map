// Fake request, response and database for handler tests. No network, no Neon.
/** `body` objects are sent as JSON text (like the page does); `form` objects arrive pre-parsed, as Vercel does for HTML forms. */
export function req({ method = "POST", url = "/api/track", headers = {}, body, form, origin, cookie } = {}) {
  const h = { ...headers };
  if (origin) h.origin = origin;
  if (cookie) h.cookie = cookie;
  if (form) { h["content-type"] = "application/x-www-form-urlencoded"; return { method, url, headers: h, body: form }; }
  return { method, url, headers: h, body: typeof body === "object" && body !== null && !Buffer.isBuffer(body) ? JSON.stringify(body) : body };
}

export function res() {
  const r = {
    statusCode: 200, headers: {}, body: "", ended: false,
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; },
    getHeader(k) { return r.headers[k.toLowerCase()]; },
    end(b) { r.body = b == null ? "" : String(b); r.ended = true; },
  };
  return r;
}

/** db.q recorder. `responder(text, params, calls)` returns rows for a query; undefined means []. */
export function fakeDb(responder) {
  const calls = [];
  return {
    calls,
    last: () => calls[calls.length - 1],
    find: re => calls.find(c => re.test(c.text)),
    q: async (text, params = []) => {
      const norm = text.replace(/\s+/g, " ").trim();
      calls.push({ text: norm, params });
      const out = responder ? await responder(norm, params, calls) : undefined;
      return out === undefined ? [] : out;
    },
  };
}

export const ORIGIN = "https://sarahschuyler-stack.github.io";
export const TOKEN = "a".repeat(43);
export const USER = "11111111-1111-4111-8111-111111111111";

/** A responder that knows the identity token and one session row. */
export function knownUser({ session = null } = {}) {
  return (text, params) => {
    if (/update identity_tokens set last_used_at/.test(text)) return [{ user_id: USER }];
    if (/select user_id from identity_tokens/.test(text)) return [{ user_id: USER }];
    if (/select id, user_id(, last_activity_at)? from sessions where id/.test(text)) return session ? [session] : [];
    if (/insert into sessions/.test(text)) return [{ inserted: !session }];
    if (/select count\(\*\)::int as n from usage_events/.test(text)) return [{ n: 0 }];
    return undefined;
  };
}
