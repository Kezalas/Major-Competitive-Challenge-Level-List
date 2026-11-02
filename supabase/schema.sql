-- =====================================================================
-- MCCLL – Record submission system (Supabase)
--
-- Run this whole file ONCE in the Supabase dashboard:
--   SQL Editor -> New query -> paste -> Run
-- It is safe to run again (idempotent where possible).
--
-- Data model
--   profiles     one row per account (username, nation, role)
--   submissions  every record a player sends in (pending/accepted/rejected)
--   records      public VIEW: only accepted submissions, only public columns.
--                The website merges these into the list + leaderboard.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    username    text not null
                check (char_length(username) between 3 and 24
                       and username ~ '^[A-Za-z0-9_.-]+$'),
    nation      text check (nation is null or nation ~ '^[A-Z]{2}$'),
    role        text not null default 'user'
                check (role in ('user', 'reviewer', 'admin')),
    created_at  timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
    on public.profiles (lower(username));

create table if not exists public.submissions (
    id             bigint generated always as identity primary key,
    -- account that submitted; NULL only for records staff entered by hand
    user_id        uuid references public.profiles (id) on delete cascade,
    -- name used when user_id is NULL (manual entries / old Google-Form records)
    player_name    text check (player_name is null or char_length(player_name) <= 48),
    level_path     text not null check (char_length(level_path) <= 128),
    level_name     text not null check (char_length(level_name) <= 128),
    level_id       bigint,
    video          text not null check (video ~* '^https?://' and char_length(video) <= 500),
    raw_footage    text check (raw_footage is null or (raw_footage ~* '^https?://' and char_length(raw_footage) <= 500)),
    percent        integer not null default 100 check (percent between 1 and 100),
    hz             integer check (hz is null or hz between 1 and 1000),
    mobile         boolean not null default false,
    comments       text check (comments is null or char_length(comments) <= 1000),
    status         text not null default 'pending'
                   check (status in ('pending', 'accepted', 'rejected')),
    reviewer_id    uuid references public.profiles (id) on delete set null,
    reviewer_note  text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
    reviewed_at    timestamptz,
    created_at     timestamptz not null default now(),
    constraint submissions_has_player check (user_id is not null or player_name is not null)
);

-- ---------------------------------------------------------------------
-- Additions (v2). Safe to run on a database that already has v1:
-- just run this whole file again.
-- ---------------------------------------------------------------------
-- CBF = Click Between Frames
alter table public.submissions add column if not exists cbf boolean not null default false;

-- profile customisation
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists banner_url text;
alter table public.profiles add column if not exists banner_color text;
alter table public.profiles add column if not exists pinned_levels text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_bio_check;
alter table public.profiles add constraint profiles_bio_check
    check (bio is null or char_length(bio) <= 300);
alter table public.profiles drop constraint if exists profiles_banner_url_check;
alter table public.profiles add constraint profiles_banner_url_check
    check (banner_url is null or (banner_url ~* '^https://' and char_length(banner_url) <= 500));
alter table public.profiles drop constraint if exists profiles_banner_color_check;
alter table public.profiles add constraint profiles_banner_color_check
    check (banner_color is null or banner_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.profiles drop constraint if exists profiles_pinned_levels_check;
alter table public.profiles add constraint profiles_pinned_levels_check
    check (cardinality(pinned_levels) <= 3);

create index if not exists submissions_status_idx on public.submissions (status, created_at);
create index if not exists submissions_user_idx   on public.submissions (user_id);

-- one open (pending) entry per player and level. Accepted records may exist
-- several times (e.g. 60% and later 100%); the `records` view shows the best.
drop index if exists public.submissions_one_active_per_level_idx;
create unique index if not exists submissions_one_pending_per_level_idx
    on public.submissions (user_id, level_path)
    where status = 'pending' and user_id is not null;

-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read profiles inside RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role in ('reviewer', 'admin')
    );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
    );
$$;

-- true when the statement comes from the website (anon/authenticated key),
-- false when it comes from the SQL editor / dashboard (postgres, service_role)
create or replace function public.is_api_request()
returns boolean
language sql stable
as $$
    select current_user in ('anon', 'authenticated');
$$;

-- ---------------------------------------------------------------------
-- New account -> profile row (username comes from the sign-up form)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    wanted text := coalesce(new.raw_user_meta_data ->> 'username', '');
    final  text;
begin
    wanted := regexp_replace(wanted, '[^A-Za-z0-9_.-]', '', 'g');
    if char_length(wanted) < 3 then
        wanted := 'player_' || substr(replace(new.id::text, '-', ''), 1, 6);
    end if;
    final := left(wanted, 24);

    -- username already taken -> append a short suffix instead of failing the sign-up
    if exists (select 1 from public.profiles where lower(username) = lower(final)) then
        final := left(wanted, 19) || '_' || substr(replace(new.id::text, '-', ''), 1, 4);
    end if;

    insert into public.profiles (id, username) values (new.id, final);
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Guards: what normal users may and may not change
-- ---------------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql
as $$
begin
    if public.is_api_request() then
        new.id := old.id;
        new.created_at := old.created_at;
        -- only admins change roles, and never their own
        -- (nobody can promote themselves, no admin can lock themselves out)
        if not public.is_admin() or old.id = auth.uid() then
            new.role := old.role;
        end if;
        -- only admins confirm GD accounts; changing the name needs a new confirmation
        if not public.is_admin() then
            if new.gd_username is distinct from old.gd_username then
                new.gd_verified := false;
            else
                new.gd_verified := old.gd_verified;
            end if;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
    before update on public.profiles
    for each row execute function public.profiles_guard();

-- ranks 1..150 accept records, everything below is Legacy
create or replace function public.main_list_size()
returns integer
language sql immutable
as $$ select 150 $$;

-- ranks 1..75 also accept progress (from the level's percent_to_qualify)
create or replace function public.progress_ranks()
returns integer
language sql immutable
as $$ select 75 $$;

create or replace function public.submissions_guard()
returns trigger
language plpgsql
as $$
declare
    open_count integer;
    lvl_rank   integer;
    lvl_min    integer;
    need       integer;
    best       integer;
begin
    if not public.is_api_request() then
        return new;                       -- dashboard / SQL editor: no limits
    end if;

    if tg_op = 'INSERT' then
        if public.is_staff() then
            -- staff may enter records for other players (manual entry)
            if new.user_id is null and new.player_name is null then
                new.user_id := auth.uid();
            end if;
            if new.status <> 'pending' then
                new.reviewer_id := auth.uid();
                new.reviewed_at := now();
            end if;
            return new;
        end if;

        -- normal player: always own, always pending
        new.user_id       := auth.uid();
        new.player_name   := null;
        new.status        := 'pending';
        new.reviewer_id   := null;
        new.reviewer_note := null;
        new.reviewed_at   := null;
        new.created_at    := now();

        select placement, percent_to_qualify into lvl_rank, lvl_min
        from public.levels where path = new.level_path;
        if lvl_rank is not null then
            -- Legacy (rank > 150) levels are locked: no new records
            if lvl_rank > public.main_list_size() then
                raise exception 'This level is on the Legacy list and does not accept records anymore.';
            end if;
            -- progress only on the top 75, from the level's percent to qualify
            need := case when lvl_rank <= public.progress_ranks() then coalesce(lvl_min, 100) else 100 end;
            if new.percent < need then
                raise exception 'Records on this level need at least %.', need || '%';
            end if;
        end if;

        -- only improvements over an accepted record
        select max(percent) into best
        from public.submissions
        where user_id = auth.uid() and level_path = new.level_path and status = 'accepted';
        if best is not null and new.percent <= best then
            raise exception 'You already have % on this level. Only better records can be submitted.', best || '%';
        end if;

        select count(*) into open_count
        from public.submissions
        where user_id = auth.uid() and status = 'pending';
        if open_count >= 20 then
            raise exception 'You already have 20 pending submissions. Please wait until they are reviewed.';
        end if;
        return new;
    end if;

    -- UPDATE (only staff reach this point, see RLS)
    if new.status is distinct from old.status then
        if new.status = 'pending' then
            new.reviewer_id := null;
            new.reviewed_at := null;
        else
            new.reviewer_id := auth.uid();
            new.reviewed_at := now();
        end if;
    end if;
    new.created_at := old.created_at;
    return new;
end;
$$;

drop trigger if exists submissions_guard on public.submissions;
create trigger submissions_guard
    before insert or update on public.submissions
    for each row execute function public.submissions_guard();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "profiles are public"          on public.profiles;
drop policy if exists "users update own profile"     on public.profiles;
drop policy if exists "read own or staff"            on public.submissions;
drop policy if exists "users submit"                 on public.submissions;
drop policy if exists "staff review"                 on public.submissions;
drop policy if exists "delete own pending or admin"  on public.submissions;

create policy "profiles are public"
    on public.profiles for select
    to anon, authenticated
    using (true);

create policy "users update own profile"
    on public.profiles for update
    to authenticated
    using (id = auth.uid() or public.is_admin())
    with check (id = auth.uid() or public.is_admin());

-- full submission rows (incl. comments, raw footage, reviewer notes) are only
-- visible to the submitter and to staff; the public uses the `records` view
create policy "read own or staff"
    on public.submissions for select
    to authenticated
    using (user_id = auth.uid() or public.is_staff());

create policy "users submit"
    on public.submissions for insert
    to authenticated
    with check (user_id = auth.uid() or public.is_staff());

create policy "staff review"
    on public.submissions for update
    to authenticated
    using (public.is_staff())
    with check (public.is_staff());

create policy "delete own pending or admin"
    on public.submissions for delete
    to authenticated
    using ((user_id = auth.uid() and status = 'pending') or public.is_admin());

-- ---------------------------------------------------------------------
-- Levels added by admins on the website (v3)
-- They are merged into the list from data/_list.json at `placement`
-- (1 = top). Records reference them by `path`, like JSON levels.
-- ---------------------------------------------------------------------
create table if not exists public.levels (
    path            text primary key check (path ~ '^[A-Za-z0-9_. -]{1,128}$'),
    -- GD level ID; text and not unique, because the old JSON data has duplicates
    -- and non-numeric values ("ask skippy")
    level_id        text check (level_id is null or char_length(level_id) <= 32),
    name            text not null check (char_length(name) between 1 and 64),
    author          text not null check (char_length(author) between 1 and 48),
    creators        text[] not null default '{}' check (cardinality(creators) <= 30),
    verifier        text not null check (char_length(verifier) between 1 and 48),
    verification    text not null check (verification ~* '^https?://' and char_length(verification) <= 500),
    showcase        text check (showcase is null or (showcase ~* '^https?://' and char_length(showcase) <= 500)),
    password        text check (password is null or char_length(password) <= 64),
    rating          text check (rating is null or rating in ('rate', 'featured', 'epic', 'legendary', 'mythic')),
    difficulty      text check (difficulty is null or difficulty in ('easy', 'medium', 'hard', 'insane', 'extreme')),
    placement       integer not null check (placement >= 1),
    percent_to_qualify integer not null default 100 check (percent_to_qualify between 1 and 100),
    created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
    created_at      timestamptz not null default now()
);

-- upgrade from v3 (numeric unique level_id, gd-only paths)
alter table public.levels drop constraint if exists levels_level_id_key;
alter table public.levels drop constraint if exists levels_level_id_check;
alter table public.levels alter column level_id drop not null;
alter table public.levels alter column level_id type text using level_id::text;
alter table public.levels add constraint levels_level_id_check
    check (level_id is null or char_length(level_id) <= 32);
alter table public.levels drop constraint if exists levels_path_check;
alter table public.levels add constraint levels_path_check
    check (path ~ '^[A-Za-z0-9_. -]{1,128}$');
alter table public.submissions alter column level_id type text using level_id::text;
alter table public.levels add column if not exists percent_to_qualify integer not null default 100;
alter table public.levels drop constraint if exists levels_percent_to_qualify_check;
alter table public.levels add constraint levels_percent_to_qualify_check
    check (percent_to_qualify between 1 and 100);

create index if not exists levels_placement_idx on public.levels (placement, created_at);

alter table public.levels enable row level security;

drop policy if exists "levels are public"      on public.levels;
drop policy if exists "admins manage levels"   on public.levels;

create policy "levels are public"
    on public.levels for select
    to anon, authenticated
    using (true);

create policy "admins manage levels"
    on public.levels for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- Ordering helpers (admins). placement = rank on the list once all
-- levels live in the database (see import_json_levels.sql).
create or replace function public.renumber_levels()
returns void
language plpgsql security definer set search_path = public
as $$
begin
    -- (inside SECURITY DEFINER current_user is the owner, so check the JWT:
    -- website calls always carry one, the SQL editor does not)
    if auth.uid() is not null and not public.is_admin() then
        raise exception 'Only admins can reorder levels.';
    end if;
    update public.levels l
    set placement = o.n
    from (
        select path, row_number() over (order by placement, created_at, path) as n
        from public.levels
    ) o
    where o.path = l.path and l.placement <> o.n;
end;
$$;

-- move one level to a rank; everything in between shifts by one
create or replace function public.move_level(p_path text, p_position integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    old_pos integer;
    max_pos integer;
begin
    -- (inside SECURITY DEFINER current_user is the owner, so check the JWT:
    -- website calls always carry one, the SQL editor does not)
    if auth.uid() is not null and not public.is_admin() then
        raise exception 'Only admins can reorder levels.';
    end if;
    perform public.renumber_levels();
    select placement into old_pos from public.levels where path = p_path;
    if old_pos is null then
        raise exception 'Level % not found.', p_path;
    end if;
    select count(*) into max_pos from public.levels;
    p_position := least(greatest(p_position, 1), max_pos);
    if p_position < old_pos then
        update public.levels set placement = placement + 1
        where placement >= p_position and placement < old_pos;
    elsif p_position > old_pos then
        update public.levels set placement = placement - 1
        where placement > old_pos and placement <= p_position;
    end if;
    update public.levels set placement = p_position where path = p_path;
end;
$$;

revoke all on function public.renumber_levels() from public, anon;
revoke all on function public.move_level(text, integer) from public, anon;
grant execute on function public.renumber_levels() to authenticated;
grant execute on function public.move_level(text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Packs (v4): groups of levels, shown on the Packs page
-- ---------------------------------------------------------------------
create table if not exists public.packs (
    id           bigint generated always as identity primary key,
    name         text not null check (char_length(name) between 1 and 48),
    description  text check (description is null or char_length(description) <= 300),
    color        text not null default '#0043dc' check (color ~ '^#[0-9a-fA-F]{6}$'),
    position     integer not null default 0,
    levels       text[] not null default '{}' check (cardinality(levels) <= 50),
    created_at   timestamptz not null default now()
);

alter table public.packs enable row level security;

drop policy if exists "packs are public"    on public.packs;
drop policy if exists "admins manage packs" on public.packs;

create policy "packs are public"
    on public.packs for select
    to anon, authenticated
    using (true);

create policy "admins manage packs"
    on public.packs for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- v5: pack bonus points, Geometry Dash account on profiles
-- ---------------------------------------------------------------------
alter table public.packs add column if not exists points numeric(8, 3) not null default 0;
alter table public.packs drop constraint if exists packs_points_check;
alter table public.packs add constraint packs_points_check check (points >= 0 and points <= 10000);

-- The GD name a player claims. It only counts (records, verifications and
-- creator credits under that name go to the account) once an admin set
-- gd_verified, so nobody can take over someone else's points.
alter table public.profiles add column if not exists gd_username text;
alter table public.profiles add column if not exists gd_verified boolean not null default false;
alter table public.profiles drop constraint if exists profiles_gd_username_check;
alter table public.profiles add constraint profiles_gd_username_check
    check (gd_username is null or gd_username ~ '^[A-Za-z0-9 _.-]{1,32}$');
create unique index if not exists profiles_gd_username_verified_idx
    on public.profiles (lower(gd_username)) where gd_verified;

-- ---------------------------------------------------------------------
-- v6: Tournaments. Staff schedules them (name, date, size, region);
-- region 'world' = World Tournament (countdown on the Tournaments page).
-- ---------------------------------------------------------------------
create table if not exists public.tournaments (
    id          bigint generated always as identity primary key,
    name        text not null check (char_length(name) between 1 and 64),
    region      text not null check (region in ('world', 'north_america', 'south_america',
                                                'europe', 'africa', 'asia', 'oceania')),
    starts_at   timestamptz not null,
    size        integer not null check (size between 2 and 4096),
    winner      text check (winner is null or char_length(winner) <= 48),
    link        text check (link is null or (link ~* '^https?://' and char_length(link) <= 500)),
    created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
    created_at  timestamptz not null default now()
);

create index if not exists tournaments_starts_at_idx on public.tournaments (starts_at);

alter table public.tournaments enable row level security;

drop policy if exists "tournaments are public"   on public.tournaments;
drop policy if exists "staff manage tournaments" on public.tournaments;

create policy "tournaments are public"
    on public.tournaments for select
    to anon, authenticated
    using (true);

create policy "staff manage tournaments"
    on public.tournaments for all
    to authenticated
    using (public.is_staff())
    with check (public.is_staff());

-- ---------------------------------------------------------------------
-- Public view of accepted records (what the list & leaderboard read)
-- Runs with the owner's rights, so it bypasses RLS, but it only ever
-- exposes accepted rows and only public columns.
-- ---------------------------------------------------------------------
-- one row per player and level: the accepted record with the highest percentage
drop view if exists public.records;
create view public.records as
    select distinct on (s.level_path, coalesce(s.user_id::text, lower(s.player_name)))
        s.id,
        s.level_path,
        coalesce(p.username, s.player_name) as "user",
        p.nation,
        s.video        as link,
        s.percent,
        s.hz,
        s.mobile,
        s.reviewed_at,
        s.cbf
    from public.submissions s
    left join public.profiles p on p.id = s.user_id
    where s.status = 'accepted'
    order by s.level_path, coalesce(s.user_id::text, lower(s.player_name)), s.percent desc, s.reviewed_at;

revoke all on public.records from anon, authenticated;
grant select on public.records to anon, authenticated;

-- ---------------------------------------------------------------------
-- Make yourself admin (run once AFTER you registered on the website,
-- replace the username):
--
--   update public.profiles set role = 'admin' where username = 'YourName';
--
-- Reviewer (may accept/reject, cannot change roles):
--
--   update public.profiles set role = 'reviewer' where username = 'SomeName';
-- ---------------------------------------------------------------------
