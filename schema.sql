-- Core extensions
create extension if not exists "pgcrypto";

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chats
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('dm', 'group')),
  title text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Chat members
create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

-- Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  reply_to_message_id uuid references public.messages(id) on delete set null,
  attachment_url text,
  attachment_type text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Reactions
create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- Read receipts
create table if not exists public.read_state (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_message_id uuid references public.messages(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

-- Notification preferences
create table if not exists public.notification_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default false,
  email_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

-- Per-chat mutes
create table if not exists public.chat_mutes (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

-- Push subscriptions
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_chat_members_user_id on public.chat_members(user_id);
create index if not exists idx_messages_chat_id_created_at on public.messages(chat_id, created_at desc);
create index if not exists idx_messages_reply_to on public.messages(reply_to_message_id);
create index if not exists idx_reactions_message_id on public.reactions(message_id);
create index if not exists idx_read_state_user_id on public.read_state(user_id);
create index if not exists idx_chat_mutes_user_id on public.chat_mutes(user_id);

-- Profile bootstrap
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;
alter table public.read_state enable row level security;
alter table public.notification_settings enable row level security;
alter table public.chat_mutes enable row level security;
alter table public.push_subscriptions enable row level security;

-- Profiles policies
create policy "Profiles viewable by authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "Users can insert their profile" on public.profiles
  for insert with check (auth.uid() = id);

create policy "Users can update their profile" on public.profiles
  for update using (auth.uid() = id);

-- Chats policies
create policy "Members can view chats" on public.chats
  for select using (
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = id and cm.user_id = auth.uid()
    )
  );

create policy "Users can create chats" on public.chats
  for insert with check (auth.uid() = created_by);

create policy "Members can update chats" on public.chats
  for update using (
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = id and cm.user_id = auth.uid()
    )
  );

-- Chat members policies
create policy "Members can view chat members" on public.chat_members
  for select using (
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = chat_members.chat_id and cm.user_id = auth.uid()
    )
  );

create policy "Creators can add members" on public.chat_members
  for insert with check (
    exists (
      select 1 from public.chats c
      where c.id = chat_members.chat_id and c.created_by = auth.uid()
    )
    or exists (
      select 1 from public.chat_members cm
      where cm.chat_id = chat_members.chat_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

create policy "Admins can update members" on public.chat_members
  for update using (
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = chat_members.chat_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

create policy "Admins can delete members" on public.chat_members
  for delete using (
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = chat_members.chat_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- Messages policies
create policy "Members can read messages" on public.messages
  for select using (
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = messages.chat_id and cm.user_id = auth.uid()
    )
  );

create policy "Members can send messages" on public.messages
  for insert with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = messages.chat_id and cm.user_id = auth.uid()
    )
  );

create policy "Authors can update messages" on public.messages
  for update using (auth.uid() = user_id);

-- Reactions policies
create policy "Members can read reactions" on public.reactions
  for select using (
    exists (
      select 1 from public.messages m
      join public.chat_members cm on cm.chat_id = m.chat_id
      where m.id = reactions.message_id and cm.user_id = auth.uid()
    )
  );

create policy "Members can react" on public.reactions
  for insert with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.messages m
      join public.chat_members cm on cm.chat_id = m.chat_id
      where m.id = reactions.message_id and cm.user_id = auth.uid()
    )
  );

create policy "Members can unreact" on public.reactions
  for delete using (auth.uid() = user_id);

-- Read state policies
create policy "Members can read read_state" on public.read_state
  for select using (
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = read_state.chat_id and cm.user_id = auth.uid()
    )
  );

create policy "Users can update their read_state" on public.read_state
  for insert with check (auth.uid() = user_id);

create policy "Users can update their read_state rows" on public.read_state
  for update using (auth.uid() = user_id);

-- Notification settings policies
create policy "Users can manage notification settings" on public.notification_settings
  for select using (auth.uid() = user_id);

create policy "Users can upsert notification settings" on public.notification_settings
  for insert with check (auth.uid() = user_id);

create policy "Users can update notification settings" on public.notification_settings
  for update using (auth.uid() = user_id);

-- Chat mute policies
create policy "Users can manage chat mutes" on public.chat_mutes
  for select using (auth.uid() = user_id);

create policy "Users can upsert chat mutes" on public.chat_mutes
  for insert with check (auth.uid() = user_id);

create policy "Users can update chat mutes" on public.chat_mutes
  for update using (auth.uid() = user_id);

create policy "Users can delete chat mutes" on public.chat_mutes
  for delete using (auth.uid() = user_id);

-- Push subscription policies
create policy "Users can manage push subscriptions" on public.push_subscriptions
  for select using (auth.uid() = user_id);

create policy "Users can upsert push subscriptions" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

create policy "Users can update push subscriptions" on public.push_subscriptions
  for update using (auth.uid() = user_id);

create policy "Users can delete push subscriptions" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- Enable realtime for key tables
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.read_state;
alter publication supabase_realtime add table public.chat_members;
alter publication supabase_realtime add table public.chats;
