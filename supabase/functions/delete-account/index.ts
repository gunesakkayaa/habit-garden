// Hesap silme: geçerli oturum + şifre yeniden doğrulama + açık onay ("SİL") gerekir.
// Auth kullanıcısı silinince ON DELETE CASCADE ile profil, alışkanlık ve tamamlanma kayıtları da silinir.
import { admin, anonClient, isLimited, MINUTE, recordAttempt, reply, serve } from "../_shared/common.ts";

serve(async (req, body) => {
  // Oturum jetonunu sunucuda doğrula (kullanıcı kimliği istemciden alınmaz).
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user || !user.email) return reply(401, { error: "Oturum geçersiz. Tekrar giriş yap." });

  // Şifre tahminini engelle: kullanıcı başına 15 dakikada 5 başarısız deneme.
  const limitKey = `delete:u:${user.id}`;
  if (await isLimited(limitKey, 5, 15 * MINUTE)) {
    return reply(429, { error: "Çok fazla başarısız deneme. Daha sonra tekrar dene." });
  }

  // Açık onay.
  const confirm = String(body.confirm ?? "").trim().toLocaleUpperCase("tr-TR");
  if (confirm !== "SİL") return reply(400, { error: 'Onay için "SİL" yazmalısın.' });

  // Şifreyi yeniden doğrula.
  const password = String(body.password ?? "").slice(0, 200);
  const { error: pwError } = await anonClient().auth.signInWithPassword({ email: user.email, password });
  if (pwError) {
    await recordAttempt(limitKey);
    return reply(401, { error: "Şifre hatalı." });
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) throw deleteError;
  return reply(200, { ok: true });
});
