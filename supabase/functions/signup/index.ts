// Kayıt: kullanıcı adı + şifre + şifre doğrulama. E-posta istenmez.
import { admin, fakeEmail, ipKey, isLimited, isValidPassword, MINUTE, normalizeUsername, purgeOldAttempts, recordAttempt, reply, serve } from "../_shared/common.ts";

serve(async (req, body) => {
  // IP başına saatte en fazla 5 kayıt denemesi (her deneme sayılır).
  const limitKey = await ipKey(req, "signup");
  if (await isLimited(limitKey, 5, 60 * MINUTE)) {
    return reply(429, { error: "Çok fazla deneme. Lütfen daha sonra tekrar dene." });
  }
  await recordAttempt(limitKey);
  await purgeOldAttempts();

  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const passwordConfirm = String(body.passwordConfirm ?? "");

  if (!username) return reply(400, { error: "Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _)." });
  if (!isValidPassword(password)) return reply(400, { error: "Şifre 8-72 karakter olmalı." });
  if (password !== passwordConfirm) return reply(400, { error: "Şifreler eşleşmiyor." });

  // Auth kullanıcısı: iç e-posta onaylı oluşturulur (gerçek e-posta yok).
  const { data, error } = await admin.auth.admin.createUser({
    email: fakeEmail(username),
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    // Çoğunlukla "zaten kayıtlı"; ayrıntı sızdırmadan genel mesaj.
    return reply(409, { error: "Bu kullanıcı adı kullanılamıyor." });
  }

  // Profil; kullanıcı adı UNIQUE olduğu için çakışma burada da yakalanır.
  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: data.user.id, username, display_name: username });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id); // yarım kalan hesabı geri al
    return reply(409, { error: "Bu kullanıcı adı kullanılamıyor." });
  }

  return reply(201, { ok: true });
});
