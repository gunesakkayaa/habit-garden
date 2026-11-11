-- localStorage verisini hesaba BİR DEFA aktarır.
-- Tek transaction: hata olursa hiçbir şey yazılmaz. Kullanıcı kimliği auth.uid()'den alınır.
-- payload: [{ "name": "...", "dates": ["YYYY-MM-DD", ...] }, ...]  (rozetler geçmişten yeniden hesaplanır)
create or replace function public.import_local_data(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  new_habit uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) > 50 then
    raise exception 'invalid payload';
  end if;

  -- Aynı anda iki aktarımı engellemek için profil satırını kilitle.
  perform 1 from public.profiles where id = uid and imported_at is null for update;
  if not found then
    raise exception 'already imported';
  end if;

  for item in select * from jsonb_array_elements(payload) loop
    if jsonb_typeof(item->'dates') <> 'array' or jsonb_array_length(item->'dates') > 3700 then
      raise exception 'invalid payload';
    end if;

    insert into public.habits (user_id, name)
    values (uid, left(btrim(item->>'name'), 40))
    returning id into new_habit;

    insert into public.completions (habit_id, user_id, date)
    select distinct new_habit, uid, x::date
    from jsonb_array_elements_text(item->'dates') as t(x)
    where x ~ '^\d{4}-\d{2}-\d{2}$' and x::date <= current_date + 1;
  end loop;

  update public.profiles set imported_at = now() where id = uid;
end;
$$;

revoke all on function public.import_local_data(jsonb) from public, anon;
grant execute on function public.import_local_data(jsonb) to authenticated;
