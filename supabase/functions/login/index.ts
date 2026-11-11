// Giriş: kullanıcı adı + şifre. Kullanıcı adı sorgusu yok; iç e-posta sunucuda türetilir,
// bu yüzden "kullanıcı var/yok" bilgisi sızmaz. Tüm hatalar aynı genel mesajı döner.
import { anonClient, clearAttempts, fakeEmail, ipKey, isLimited, MINUTE, normalizeUsername, recordAttempt, reply, serve } from "../_shared/common.ts";

const GENERIC = "Kullanıcı adı veya şifre hatalı.";
const WINDOW = 15 * MINUTE;

serve(async (req, body) => {
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "").slice(0, 200);
  const ipLimitKey = await ipKey(req, "login");
  const userLimitKey = username ? `login:u:${username}` : null;

  // Başarısız deneme sınırları: kullanıcı adı başına 5, IP başına 20 (15 dk).
  if ((await isLimited(ipLimitKey, 20, WINDOW)) || (userLimitKey && (await isLimited(userLimitKey, 5, WINDOW)))) {
    return reply(429, { error: "Çok fazla başarısız deneme. 15 dakika sonra tekrar dene." });
  }

  if (!username || !password) {
    await recordAttempt(ipLimitKey);
    return reply(401, { error: GENERIC });
  }

  const { data, error } = await anonClient().auth.signInWithPassword({ email: fakeEmail(username), password });
  if (error || !data.session) {
    await recordAttempt(ipLimitKey);
    await recordAttempt(userLimitKey!);
    return reply(401, { error: GENERIC });
  }

  await clearAttempts(userLimitKey!);
  const { access_token, refresh_token, expires_at } = data.session;
  return reply(200, { session: { access_token, refresh_token, expires_at } });
});
