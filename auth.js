// Giriş / kayıt arayüzü ve oturum yönetimi.
// Kayıt ve giriş Edge Function'lar üzerinden yapılır; tarayıcıda yalnızca publishable key bulunur.
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const authView = $("auth-view");
const appView = $("app-view");
const authForm = $("auth-form");
let mode = "login"; // "login" | "signup"

// ---- Giriş / Kayıt kartı ----
function setMode(next) {
  mode = next;
  const signup = mode === "signup";
  $("auth-title").textContent = signup ? "Kayıt Ol" : "Giriş Yap";
  $("auth-submit").textContent = signup ? "Kayıt Ol" : "Giriş Yap";
  $("auth-switch-text").textContent = signup ? "Zaten hesabın var mı?" : "Hesabın yok mu?";
  $("auth-switch").textContent = signup ? "Giriş Yap" : "Kayıt Ol";
  $("confirm-row").hidden = !signup;
  $("auth-confirm").required = signup;
  $("auth-note").hidden = !signup;
  $("auth-password").autocomplete = signup ? "new-password" : "current-password";
  setAuthError("");
}

function setAuthError(message) {
  $("auth-error").textContent = message;
  $("auth-error").hidden = !message;
}

async function callFunction(name, payload, accessToken) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setAuthError("");
  const username = $("auth-username").value.trim().toLowerCase();
  const password = $("auth-password").value;
  const passwordConfirm = $("auth-confirm").value;

  if (mode === "signup") {
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return setAuthError("Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _).");
    if (password.length < 8) return setAuthError("Şifre en az 8 karakter olmalı.");
    if (password !== passwordConfirm) return setAuthError("Şifreler eşleşmiyor.");
  }

  $("auth-submit").disabled = true;
  try {
    if (mode === "signup") {
      const signup = await callFunction("signup", { username, password, passwordConfirm });
      if (!signup.ok) return setAuthError(signup.data.error || "Kayıt yapılamadı.");
    }
    const login = await callFunction("login", { username, password });
    if (!login.ok) return setAuthError(login.data.error || "Giriş yapılamadı.");

    const { error } = await db.auth.setSession(login.data.session);
    if (error) return setAuthError("Giriş yapılamadı.");
    authForm.reset(); // şifre formda kalmasın
  } catch {
    setAuthError("Bağlantı hatası. Tekrar dene.");
  } finally {
    $("auth-submit").disabled = false;
  }
});

$("auth-switch").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
$("logout").addEventListener("click", () => db.auth.signOut());

// ---- Ayarlar ----
const settings = $("settings");
let profile = null; // { username, display_name }

function setMsg(id, text, ok = false) {
  const el = $(id);
  el.textContent = text;
  el.className = ok ? "form-msg ok" : "form-msg";
  el.hidden = !text;
}

function renderWelcome() {
  $("welcome").textContent = profile ? `Merhaba, ${profile.display_name}` : "";
}

function renderSettingsBadges() {
  const box = $("set-badges");
  box.innerHTML = "";
  if (habits.length === 0) {
    box.textContent = "Henüz alışkanlık yok.";
    return;
  }
  const total = habits.reduce((sum, h) => sum + (h.badges || []).length, 0);
  const summary = document.createElement("p");
  summary.className = "set-hint";
  summary.textContent = `Toplam ${total} rozet kazandın.`;
  box.appendChild(summary);

  habits.forEach((habit) => {
    const row = document.createElement("div");
    row.className = "badge-row";
    const name = document.createElement("span");
    name.textContent = `${getPlant(habit.dates.length)} ${habit.name}`;
    const chips = document.createElement("div");
    chips.className = "badges";
    chips.innerHTML = BADGES.map(
      (b) => `<span class="badge ${(habit.badges || []).includes(b.days) ? "earned" : ""}">${b.icon} ${b.days}</span>`
    ).join("");
    row.append(name, chips);
    box.appendChild(row);
  });
}

function resetSettings() {
  ["profile-form", "password-form", "delete-form"].forEach((id) => $(id).reset());
  ["profile-msg", "password-msg", "delete-msg"].forEach((id) => setMsg(id, ""));
  document.querySelector(".danger-zone").open = false;
}

$("settings-btn").addEventListener("click", () => {
  resetSettings();
  $("set-username").textContent = profile ? `@${profile.username}` : "";
  $("set-display-name").value = profile ? profile.display_name : "";
  renderSettingsBadges();
  settings.showModal();
});
$("settings-close").addEventListener("click", () => settings.close());

// Profil adı (giriş kullanıcı adı değişmez)
$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("set-display-name").value.trim();
  if (!name) return setMsg("profile-msg", "Profil adı boş olamaz.");
  const { error } = await db.from("profiles").update({ display_name: name }).eq("id", activeUser);
  if (error) return setMsg("profile-msg", "Profil adı kaydedilemedi. Tekrar dene.");
  profile.display_name = name;
  renderWelcome();
  setMsg("profile-msg", "Profil adı güncellendi.", true);
});

// Şifre değiştirme: mevcut şifre `login` fonksiyonu (hız sınırlı) ile doğrulanır, sonra Supabase Auth güncellenir.
$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const current = $("set-current").value;
  const next = $("set-new").value;
  if (next.length < 8 || next.length > 72) return setMsg("password-msg", "Yeni şifre 8-72 karakter olmalı.");
  if (next !== $("set-new-confirm").value) return setMsg("password-msg", "Yeni şifreler eşleşmiyor.");
  if (next === current) return setMsg("password-msg", "Yeni şifre mevcut şifreden farklı olmalı.");

  const button = e.submitter;
  button.disabled = true;
  try {
    const check = await callFunction("login", { username: profile.username, password: current });
    if (!check.ok) {
      return setMsg("password-msg", check.status === 429 ? check.data.error : "Mevcut şifre hatalı.");
    }
    const { error } = await db.auth.updateUser({ password: next });
    if (error) return setMsg("password-msg", "Şifre değiştirilemedi. Tekrar dene.");
    $("password-form").reset();
    setMsg("password-msg", "Şifre güncellendi.", true);
  } catch {
    setMsg("password-msg", "Bağlantı hatası. Tekrar dene.");
  } finally {
    button.disabled = false;
  }
});

// Hesabı sil: şifre + "SİL" onayı, işlem sunucudaki delete-account fonksiyonunda doğrulanır.
$("delete-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    const { data } = await db.auth.getSession();
    if (!data.session) return setMsg("delete-msg", "Oturum bulunamadı. Tekrar giriş yap.");
    const result = await callFunction(
      "delete-account",
      { password: $("del-password").value, confirm: $("del-confirm").value },
      data.session.access_token
    );
    if (!result.ok) return setMsg("delete-msg", result.data.error || "Hesap silinemedi.");
    await db.auth.signOut({ scope: "local" }); // hesap silindi; yerel oturumu temizle
  } catch {
    setMsg("delete-msg", "Bağlantı hatası. Tekrar dene.");
  } finally {
    button.disabled = false;
  }
});

// ---- Oturum durumu ----
let activeUser; // undefined: henüz belirlenmedi, null: çıkış yapılmış

async function syncSession(session) {
  const userId = session ? session.user.id : null;
  if (userId === activeUser) return; // jeton yenilemede veriyi yeniden yükleme
  activeUser = userId;

  if (!userId) {
    profile = null;
    stopApp();
    settings.close();
    resetSettings();
    appView.hidden = true;
    authView.hidden = false;
    return;
  }

  authView.hidden = true;
  appView.hidden = false;
  const { data } = await db.from("profiles").select("username, display_name").maybeSingle();
  profile = data;
  renderWelcome();
  await startApp();
}

// Not: bu geri çağrımın içinde Supabase isteğini bekleme (kilitlenme riski), bu yüzden erteleniyor.
db.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => syncSession(session), 0);
});
