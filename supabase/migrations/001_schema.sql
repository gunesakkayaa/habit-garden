-- Habit Garden: şema + Row Level Security

-- PROFİLLER (kullanıcı adı sabit, görünen ad düzenlenebilir)
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  imported_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ALIŞKANLIKLAR
create table public.habits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  badges     int[] not null default '{}' check (badges <@ array[3, 7, 14]),
  created_at timestamptz not null default now()
);
create index habits_user_idx on public.habits(user_id);

-- TAMAMLANMA KAYITLARI
create table public.completions (
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date     date not null,
  primary key (habit_id, date)
);
create index completions_user_idx on public.completions(user_id);

-- HIZ SINIRI KAYITLARI (yalnızca Edge Function / service_role erişir)
create table public.auth_attempts (
  id         bigint generated always as identity primary key,
  key        text not null,
  created_at timestamptz not null default now()
);
create index auth_attempts_key_idx on public.auth_attempts(key, created_at);

-- RLS
alter table public.profiles      enable row level security;
alter table public.habits        enable row level security;
alter table public.completions   enable row level security;
alter table public.auth_attempts enable row level security; -- politika yok: kimse erişemez

create policy "profil: kendi satırını oku" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profil: kendi satırını güncelle" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- INSERT/DELETE politikası yok: profil yalnızca signup fonksiyonu ile oluşur,
-- hesap silinince cascade ile gider.

create policy "alışkanlık: kendi kayıtları" on public.habits
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "tamamlanma: kendi kayıtları" on public.completions
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = auth.uid())
  );

-- YETKİLER: anon hiçbir tabloya erişemez; authenticated yalnızca gerekenleri yapar
revoke all on public.profiles, public.habits, public.completions, public.auth_attempts from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated; -- kullanıcı adı değiştirilemez
grant select, insert, update, delete on public.habits, public.completions to authenticated;
