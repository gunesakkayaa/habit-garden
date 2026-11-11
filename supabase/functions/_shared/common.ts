// Edge Function'lar için ortak yardımcılar.
// SUPABASE_URL, SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından
// fonksiyon ortamına otomatik eklenir; kodda veya repoda hiçbir anahtar bulunmaz.
// ALLOWED_ORIGINS: `supabase secrets set ALLOWED_ORIGINS=https://...` ile ayarlanır.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (key: string) => Deno.env.get(key) ?? "";
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

// Yetkili istemci (RLS'i atlar) – yalnızca sunucuda.
export const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), clientOptions);
// Şifre doğrulamak için normal istemci.
export const anonClient = () => createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), clientOptions);

// ---- Kullanıcı adı / şifre ----
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(input: unknown): string | null {
  const name = String(input ?? "").trim().toLowerCase();
  return USERNAME_RE.test(name) ? name : null;
}

// Kullanıcıya hiç gösterilmeyen, sunucuda türetilen iç e-posta.
export const fakeEmail = (username: string) => `${username}@users.habitgarden.invalid`;

export const isValidPassword = (p: string) => p.length >= 8 && p.length <= 72; // 72: bcrypt sınırı

// ---- Hız sınırı (auth_attempts tablosu) ----
export const MINUTE = 60_000;

export async function isLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await admin
    .from("auth_attempts")
    .select("id", { count: "exact", head: true })
    .eq("key", key)
    .gt("created_at", since);
  if (error) throw error; // hata olursa sınırı açma: istek 500 ile reddedilir
  return (count ?? 0) >= max;
}

export async function recordAttempt(key: string) {
  const { error } = await admin.from("auth_attempts").insert({ key });
  if (error) throw error;
}

export async function clearAttempts(key: string) {
  await admin.from("auth_attempts").delete().eq("key", key);
}

export async function purgeOldAttempts() {
  const cutoff = new Date(Date.now() - 24 * 60 * MINUTE).toISOString();
  await admin.from("auth_attempts").delete().lt("created_at", cutoff);
}

// IP adresi ham haliyle saklanmaz, kısa bir hash'i kullanılır.
export async function ipKey(req: Request, prefix: string): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hex = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}:ip:${hex}`;
}

// ---- HTTP sarmalayıcı (CORS, yöntem kontrolü, hata yakalama) ----
type Result = { status: number; body: unknown };
export const reply = (status: number, body: unknown): Result => ({ status, body });

function corsHeaders(req: Request): Record<string, string> {
  const allowed = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<Result>) {
  Deno.serve(async (req) => {
    const headers = corsHeaders(req);
    const send = (r: Result) => new Response(JSON.stringify(r.body), { status: r.status, headers });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return send(reply(405, { error: "İzin verilmeyen yöntem" }));

    // Tarayıcıdan gelen ama izinli olmayan kaynakları reddet.
    const origin = req.headers.get("origin");
    if (origin && !headers["Access-Control-Allow-Origin"]) return send(reply(403, { error: "İzin verilmeyen kaynak" }));

    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (typeof body !== "object" || body === null) throw new Error("bad body");
    } catch {
      return send(reply(400, { error: "Geçersiz istek" }));
    }

    try {
      return send(await handler(req, body));
    } catch (e) {
      console.error(e); // ayrıntı yalnızca sunucu logunda
      return send(reply(500, { error: "Bir hata oluştu, lütfen tekrar dene" }));
    }
  });
}
