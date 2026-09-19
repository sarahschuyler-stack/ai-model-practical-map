// POST /admin/logout clears the admin cookie.
import { redirect, send } from "../../lib/http.js";
import { clearSessionCookie } from "../../lib/admin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, "", { Allow: "POST" });
  clearSessionCookie(res);
  return redirect(res, "/admin/login");
}
