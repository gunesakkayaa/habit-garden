const DAY_NAMES = ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"];

let habits = []; // giriş yapan kullanıcının verisi (Supabase'den gelir)

const form = document.getElementById("habit-form");
const input = document.getElementById("habit-input");
const list = document.getElementById("habit-list");
const empty = document.getElementById("empty");

// ---- Veri (Supabase; `db` istemcisi auth.js içinde tanımlı) ----
function showError(message) {
  const el = document.getElementById("app-error");
  el.textContent = message;
  el.hidden = !message;
}

// Supabase tek istekte en fazla 1000 satır döner; sayfa sayfa çek.
async function fetchAll(table, columns, orderBy) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from(table).select(columns);
    orderBy.forEach((col) => (query = query.order(col)));
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function loadHabits() {
  const [habitRows, completionRows] = await Promise.all([
    fetchAll("habits", "id, name, badges", ["created_at", "id"]),
    fetchAll("completions", "habit_id, date", ["habit_id", "date"]),
  ]);
  return habitRows.map((h) => ({
    ...h,
    dates: completionRows.filter((c) => c.habit_id === h.id).map((c) => c.date),
  }));
}

// Giriş yapılınca çağrılır (auth.js)
async function startApp() {
  showError("");
  try {
    habits = await loadHabits();
  } catch {
    habits = [];
    showError("Veriler yüklenemedi. Sayfayı yenilemeyi dene.");
  }
  render();
}

// Çıkışta önceki kullanıcının verisi ekranda kalmasın
function stopApp() {
  habits = [];
  calHabitId = null;
  list.innerHTML = "";
  showError("");
}

// ---- Tarih yardımcıları (yerel saat) ----
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ---- Hesaplamalar ----
function getStreak(habit) {
  // Bugün henüz işaretlenmediyse dünden say.
  let i = habit.dates.includes(dateKey(daysAgo(0))) ? 0 : 1;
  let streak = 0;
  while (habit.dates.includes(dateKey(daysAgo(i)))) {
    streak++;
    i++;
  }
  return streak;
}

function getPlant(total) {
  if (total >= 14) return "🌳";
  if (total >= 7) return "🪴";
  if (total >= 3) return "🌿";
  return "🌱";
}

// Bir sonraki aşamaya ilerleme bilgisi
const STAGES = [0, 3, 7, 14];

function getGrowth(total) {
  const next = STAGES.find((s) => s > total);
  if (next === undefined) return { percent: 100, text: "Tam büyüdü! 🎉" };
  const prev = STAGES[STAGES.indexOf(next) - 1];
  const left = next - total;
  return {
    percent: ((total - prev) / (next - prev)) * 100,
    text: `Sonraki aşamaya ${left} gün kaldı`,
  };
}

function renderProgress() {
  const today = dateKey(new Date());
  const done = habits.filter((h) => h.dates.includes(today)).length;
  const percent = habits.length ? Math.round((done / habits.length) * 100) : 0;
  document.getElementById("progress").hidden = habits.length === 0;
  document.getElementById("progress-text").textContent = `${done}/${habits.length} · %${percent}`;
  document.getElementById("progress-fill").style.width = percent + "%";
  document.querySelector(".bar").setAttribute("aria-valuenow", percent);
}

// ---- Aylık takvim ----
const WEEKDAYS = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
let calHabitId = null;
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function renderCalendar() {
  const section = document.getElementById("calendar");
  section.hidden = habits.length === 0;
  if (habits.length === 0) return;

  if (!habits.some((h) => h.id === calHabitId)) calHabitId = habits[0].id;
  const habit = habits.find((h) => h.id === calHabitId);

  const select = document.getElementById("cal-habit");
  select.innerHTML = "";
  habits.forEach((h) => {
    const option = document.createElement("option");
    option.value = h.id;
    option.textContent = `${getPlant(h.dates.length)} ${h.name}`;
    option.selected = h.id === calHabitId;
    select.appendChild(option);
  });

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  document.getElementById("cal-title").textContent = calMonth.toLocaleDateString("tr-TR", {
    month: "long",
    year: "numeric",
  });

  const offset = (new Date(year, month, 1).getDay() + 6) % 7; // hafta Pazartesi başlar
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = dateKey(new Date());
  let html = WEEKDAYS.map((d) => `<div class="cal-head">${d}</div>`).join("");
  html += "<div></div>".repeat(offset);
  let doneCount = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(new Date(year, month, day));
    const classes = ["cal-day"];
    if (key > today) {
      classes.push("future"); // gelecek günler hiçbir zaman tamamlanmış görünmez
    } else if (habit.dates.includes(key)) {
      classes.push("done");
      doneCount++;
    }
    if (key === today) classes.push("today");
    html += `<div class="${classes.join(" ")}">${day}</div>`;
  }

  document.getElementById("cal-grid").innerHTML = html;
  document.getElementById("cal-summary").textContent = `Bu ay ${doneCount} gün tamamlandı`;
}

// ---- Rozetler ----
const BADGES = [
  { days: 3, icon: "🥉" },
  { days: 7, icon: "🥈" },
  { days: 14, icon: "🥇" },
];

function nextDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + 1));
}

// Tüm geçmişteki en uzun ardışık seri
function getLongestStreak(dates) {
  let best = 0;
  let run = 0;
  let prev = null;
  [...new Set(dates)].sort().forEach((key) => {
    run = prev && key === nextDayKey(prev) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  });
  return best;
}

// Geçmişten kazanılan rozetleri ekler; kazanılan rozet asla silinmez.
function updateBadges() {
  habits.forEach((habit) => {
    if (!habit.badges) habit.badges = [];
    const best = getLongestStreak(habit.dates);
    let changed = false;
    BADGES.forEach((b) => {
      if (best >= b.days && !habit.badges.includes(b.days)) {
        habit.badges.push(b.days);
        changed = true;
      }
    });
    if (changed) {
      db.from("habits")
        .update({ badges: habit.badges })
        .eq("id", habit.id)
        .then(({ error }) => error && showError("Rozet kaydedilemedi."));
    }
  });
}

// ---- İşlemler ----
async function renameHabit(id) {
  const habit = habits.find((h) => h.id === id);
  const name = prompt("Alışkanlık adı:", habit.name);
  if (name === null) return; // vazgeçildi
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return;
  const { error } = await db.from("habits").update({ name: trimmed }).eq("id", id);
  if (error) return showError("Ad değiştirilemedi. Tekrar dene.");
  showError("");
  habit.name = trimmed;
  render();
}

async function addHabit(name) {
  const { data, error } = await db.from("habits").insert({ name }).select("id, name, badges").single();
  if (error) return showError("Alışkanlık eklenemedi. Tekrar dene.");
  showError("");
  habits.push({ ...data, dates: [] });
  render();
}

async function deleteHabit(id) {
  const { error } = await db.from("habits").delete().eq("id", id); // tamamlanma kayıtları cascade ile silinir
  if (error) return showError("Alışkanlık silinemedi. Tekrar dene.");
  showError("");
  habits = habits.filter((h) => h.id !== id);
  render();
}

let toggling = false; // çift tıklamada aynı günü iki kez eklemeyi engeller

async function toggleToday(id) {
  if (toggling) return;
  toggling = true;
  try {
    const habit = habits.find((h) => h.id === id);
    const today = dateKey(new Date());
    const done = habit.dates.includes(today);
    const { error } = done
      ? await db.from("completions").delete().eq("habit_id", id).eq("date", today)
      : await db.from("completions").insert({ habit_id: id, date: today });
    if (error) return showError("Kaydedilemedi. Tekrar dene.");
    showError("");
    habit.dates = done ? habit.dates.filter((d) => d !== today) : [...habit.dates, today];
    render();
  } finally {
    toggling = false;
  }
}

// ---- Görünüm ----
function render() {
  list.innerHTML = "";
  empty.hidden = habits.length > 0;
  updateBadges();
  renderProgress();
  renderCalendar();
  const today = dateKey(new Date());

  habits.forEach((habit) => {
    const doneToday = habit.dates.includes(today);

    let week = "";
    for (let i = 6; i >= 0; i--) {
      const date = daysAgo(i);
      const key = dateKey(date);
      const classes = ["dot"];
      if (habit.dates.includes(key)) classes.push("done");
      if (i === 0) classes.push("today");
      week += `<div class="day"><span class="${classes.join(" ")}"></span>${DAY_NAMES[date.getDay()]}</div>`;
    }

    const growth = getGrowth(habit.dates.length);
    const li = document.createElement("li");
    li.className = "habit";
    li.innerHTML = `
      <div class="habit-top">
        <span class="plant">${getPlant(habit.dates.length)}</span>
        <div class="info">
          <div class="name"></div>
          <div class="meta">🔥 ${getStreak(habit)} gün seri · ${habit.dates.length} gün toplam</div>
          <div class="growth">
            <div class="growth-bar"><div class="growth-fill" style="width:${growth.percent}%"></div></div>
            <div class="growth-text">${growth.text}</div>
          </div>
          <div class="badges">${BADGES.map(
            (b) =>
              `<span class="badge ${habit.badges.includes(b.days) ? "earned" : ""}" title="${b.days} günlük seri">${b.icon} ${b.days}</span>`
          ).join("")}</div>
        </div>
        <button class="edit" aria-label="Adı düzenle">✎</button>
        <button class="delete" aria-label="Sil">✕</button>
      </div>
      <div class="week">${week}</div>
      <button class="toggle ${doneToday ? "done" : ""}">${doneToday ? "✓ Bugün tamamlandı (geri al)" : "Bugünü tamamla"}</button>
    `;
    li.querySelector(".name").textContent = habit.name; // XSS'e karşı textContent
    li.querySelector(".edit").addEventListener("click", () => renameHabit(habit.id));
    li.querySelector(".delete").addEventListener("click", () => {
      if (confirm(`"${habit.name}" silinsin mi?`)) deleteHabit(habit.id);
    });
    li.querySelector(".toggle").addEventListener("click", () => toggleToday(habit.id));
    list.appendChild(li);
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = input.value.trim();
  if (!name) return;
  addHabit(name);
  input.value = "";
});

document.getElementById("cal-habit").addEventListener("change", (e) => {
  calHabitId = e.target.value; // uuid
  renderCalendar();
});

document.getElementById("cal-prev").addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById("cal-next").addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  renderCalendar();
});
