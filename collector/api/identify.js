// POST /api/identify  {v:1, email}  ->  {token, exp}
// Creates or finds the user and issues a random identity token that the page keeps for IDENTITY_DAYS.
// Only the token's SHA-256 is stored. Today the token is issued immediately; the magic-link upgrade
// moves issuance to a /api/verify step and leaves everything downstream unchanged.
import crypto from "node:crypto";
import { withDb } from "../lib/db.js";
import { cors, readBody, json, send } from "../lib/http.js";
import { parseIdentify, BadRequest } from "../lib/validate.js";

export const IDENTITY_DAYS = 7;
const PER_HOUR = 20;

export function makeHandler(db) {
  return async (req, res) => {
    const c = cors(req, res);
    if (c === "preflight") return;
    if (c === "forbidden") return send(res, 403, "");
    if (req.method !== "POST") return send(res, 405, "", { Allow: "POST, OPTIONS" });
    let e;
    try { e = parseIdentify(await readBody(req, 1024)); }
    catch (err) { return err instanceof BadRequest ? json(res, 400, { error: err.message }) : json(res, 500, { error: "server error" }); }
    try {
      const [user] = await db.q(
        `insert into users (email, normalized_email) values ($1, $2)
         on conflict (normalized_email) do update set last_seen_at = now(), updated_at = now()
         returning id`, [e.email, e.normalized]);
      const [{ n }] = await db.q("select count(*)::int as n from identity_tokens where user_id = $1 and created_at > now() - interval '1 hour'", [user.id]);
      if (n >= PER_HOUR) return json(res, 429, { error: "too many sign-ins; try again later" });
      const token = crypto.randomBytes(32).toString("base64url");
      const hash = crypto.createHash("sha256").update(token).digest();
      const exp = new Date(Date.now() + IDENTITY_DAYS * 864e5);
      await db.q("insert into identity_tokens (token_hash, user_id, expires_at) values ($1, $2, $3)", [hash, user.id, exp.toISOString()]);
      return json(res, 200, { token, exp: exp.toISOString() });
    } catch (err) {
      console.error("identify failed:", err);
      return json(res, 500, { error: "server error" });
    }
  };
}

export default withDb(makeHandler);
