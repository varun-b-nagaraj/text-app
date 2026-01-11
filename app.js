import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const config = window.__CONFIG__ || {};

if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
  alert("Missing config.js. Copy config.template.js to config.js and fill in your Supabase keys.");
}

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});

const EMOJI_SET = ["👍", "❤️", "😂", "😮", "😢", "👀"];
const PAGE_SIZE = 30;

const state = {
  session: null,
  user: null,
  profile: null,
  chats: [],
  currentChatId: null,
  membersByChat: new Map(),
  messages: new Map(),
  reactions: new Map(),
  readStates: new Map(),
  unreadChatIds: new Set(),
  hasMore: true,
  page: 0,
  loadingMessages: false,
  replyingToId: null,
  editingId: null,
  attachmentFile: null,
  attachmentPreviewUrl: null,
  typingChannel: null,
  messageChannel: null,
  reactionChannel: null,
  readChannel: null,
  globalMessageChannel: null,
  typingTimeout: null,
  searchActive: false,
  mutedChats: new Map(),
  chatReadStates: new Map()
};

const els = {
  authScreen: document.getElementById("auth-screen"),
  app: document.getElementById("app"),
  authForm: document.getElementById("auth-form"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  magicLinkBtn: document.getElementById("magic-link-btn"),
  authNote: document.getElementById("auth-note"),
  profileName: document.getElementById("profile-name"),
  profileAvatar: document.getElementById("profile-avatar"),
  logoutBtn: document.getElementById("logout-btn"),
  chatList: document.getElementById("chat-list"),
  chatTitle: document.getElementById("chat-title"),
  chatSubtitle: document.getElementById("chat-subtitle"),
  chatSearch: document.getElementById("chat-search"),
  chatSearchForm: document.getElementById("chat-search-form"),
  chatSearchInput: document.getElementById("chat-search-input"),
  clearSearchBtn: document.getElementById("clear-search-btn"),
  messageList: document.getElementById("message-list"),
  scrollAnchor: document.getElementById("scroll-anchor"),
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("message-input"),
  attachmentInput: document.getElementById("attachment-input"),
  replyPreview: document.getElementById("reply-preview"),
  attachmentPreview: document.getElementById("attachment-preview"),
  emojiBtn: document.getElementById("emoji-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsModal: document.getElementById("settings-modal"),
  displayNameInput: document.getElementById("display-name-input"),
  saveProfileBtn: document.getElementById("save-profile-btn"),
  pushToggle: document.getElementById("push-toggle"),
  emailToggle: document.getElementById("email-toggle"),
  quietStart: document.getElementById("quiet-start"),
  quietEnd: document.getElementById("quiet-end"),
  saveQuietBtn: document.getElementById("save-quiet-btn"),
  muteList: document.getElementById("mute-list"),
  newChatBtn: document.getElementById("new-chat-btn"),
  newChatModal: document.getElementById("new-chat-modal"),
  dmSearch: document.getElementById("dm-search"),
  dmResults: document.getElementById("dm-results"),
  createDmBtn: document.getElementById("create-dm-btn"),
  groupTitle: document.getElementById("group-title"),
  groupSearch: document.getElementById("group-search"),
  groupResults: document.getElementById("group-results"),
  groupSelected: document.getElementById("group-selected"),
  createGroupBtn: document.getElementById("create-group-btn"),
  typingIndicator: document.getElementById("typing-indicator"),
  lightbox: document.getElementById("lightbox"),
  lightboxImage: document.getElementById("lightbox-image"),
  toastContainer: document.getElementById("toast-container"),
  muteChatBtn: document.getElementById("mute-chat-btn"),
  addMemberBtn: document.getElementById("add-member-btn"),
  notificationDot: document.getElementById("notification-dot")
};

const dmSelection = new Set();
const groupSelection = new Map();

init();

async function init() {
  bindUI();

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    setSession(data.session);
  } else {
    showAuth();
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      setSession(session);
    } else {
      showAuth();
    }
  });
}

function bindUI() {
  els.authForm.addEventListener("submit", handlePasswordAuth);
  els.magicLinkBtn.addEventListener("click", handleMagicLink);
  els.logoutBtn.addEventListener("click", handleLogout);
  els.chatSearch.addEventListener("input", renderChatList);
  els.chatSearchForm.addEventListener("submit", handleChatSearch);
  els.clearSearchBtn.addEventListener("click", clearSearch);
  els.composer.addEventListener("submit", handleSendMessage);
  els.messageInput.addEventListener("keydown", handleComposerKeydown);
  els.messageInput.addEventListener("input", handleTyping);
  els.attachmentInput.addEventListener("change", handleAttachment);
  els.messageList.addEventListener("click", handleMessageListClick);
  els.messageList.addEventListener("scroll", () => {
    if (isScrolledToBottom()) {
      markChatRead();
    }
  });
  els.emojiBtn.addEventListener("click", () => toast("Reactions are on each message."));
  els.settingsBtn.addEventListener("click", () => toggleModal(els.settingsModal, true));
  els.saveProfileBtn.addEventListener("click", saveProfile);
  els.pushToggle.addEventListener("change", handlePushToggle);
  els.emailToggle.addEventListener("change", handleEmailToggle);
  els.saveQuietBtn.addEventListener("click", saveQuietHours);
  els.newChatBtn.addEventListener("click", () => toggleModal(els.newChatModal, true));
  els.dmSearch.addEventListener("input", () => searchProfiles(els.dmSearch.value, els.dmResults, dmSelection, false));
  els.groupSearch.addEventListener("input", () => searchProfiles(els.groupSearch.value, els.groupResults, groupSelection, true));
  els.createDmBtn.addEventListener("click", createDm);
  els.createGroupBtn.addEventListener("click", createGroup);
  els.muteChatBtn.addEventListener("click", quickMuteChat);
  els.addMemberBtn.addEventListener("click", () => toast("Use New chat to add members for now."));

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const modal = event.target.closest(".modal");
      toggleModal(modal, false);
    });
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
    }
  });

  els.lightbox.addEventListener("click", (event) => {
    if (event.target === els.lightbox) {
      toggleModal(els.lightbox, false);
    }
  });

  setupScrollObserver();
}

function showAuth() {
  els.authScreen.classList.remove("hidden");
  els.app.classList.add("hidden");
  state.session = null;
  state.user = null;
  state.profile = null;
  cleanupSubscriptions();
  if (state.globalMessageChannel) {
    supabase.removeChannel(state.globalMessageChannel);
    state.globalMessageChannel = null;
  }
}

function showApp() {
  els.authScreen.classList.add("hidden");
  els.app.classList.remove("hidden");
}

async function setSession(session) {
  state.session = session;
  state.user = session.user;
  showApp();
  await loadProfile();
  await loadChats();
  const params = new URLSearchParams(window.location.search);
  const targetChat = params.get("chat");
  if (targetChat && state.chats.some((chat) => chat.id === targetChat)) {
    openChat(targetChat);
  } else if (state.chats.length > 0) {
    openChat(state.chats[0].id);
  } else {
    els.chatTitle.textContent = "No chats yet";
    els.chatSubtitle.textContent = "Start one with the New chat button.";
  }
}

async function handleMagicLink() {
  const email = els.authEmail.value.trim();
  if (!email) {
    toast("Enter an email first.");
    return;
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: config.APP_URL || window.location.origin
    }
  });
  if (error) {
    toast(error.message);
    return;
  }
  els.authNote.textContent = "Magic link sent. Check your inbox.";
}

async function handlePasswordAuth(event) {
  event.preventDefault();
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;

  if (!email || !password) {
    toast("Enter email + password or use magic link.");
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) {
    return;
  }

  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    toast(signUpError.message);
    return;
  }
  els.authNote.textContent = "Check your inbox to confirm your account.";
}

async function handleLogout() {
  await supabase.auth.signOut();
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", state.user.id)
    .maybeSingle();

  if (error) {
    toast(error.message);
    return;
  }

  if (!data) {
    const displayName = state.user.email ? state.user.email.split("@")[0] : "Anonymous";
    const { data: created, error: insertError } = await supabase
      .from("profiles")
      .insert({ id: state.user.id, display_name: displayName })
      .select()
      .single();

    if (insertError) {
      toast(insertError.message);
      return;
    }
    state.profile = created;
  } else {
    state.profile = data;
  }

  els.profileName.textContent = state.profile.display_name || "Anonymous";
  els.profileAvatar.textContent = initials(state.profile.display_name || "ME");
  els.displayNameInput.value = state.profile.display_name || "";
}

async function loadChats() {
  const { data, error } = await supabase
    .from("chat_members")
    .select("chat_id, role, chats(id, type, title, created_at)")
    .eq("user_id", state.user.id)
    .order("joined_at", { ascending: false });

  if (error) {
    toast(error.message);
    return;
  }

  const memberships = data || [];
  const chatIds = memberships.map((item) => item.chat_id);
  state.unreadChatIds = new Set();

  if (chatIds.length === 0) {
    state.chats = [];
    renderChatList();
    return;
  }

  const { data: members } = await supabase
    .from("chat_members")
    .select("chat_id, user_id, profiles(display_name, avatar_url)")
    .in("chat_id", chatIds);

  state.membersByChat = new Map();
  (members || []).forEach((member) => {
    if (!state.membersByChat.has(member.chat_id)) {
      state.membersByChat.set(member.chat_id, []);
    }
    state.membersByChat.get(member.chat_id).push(member);
  });

  const { data: readStates } = await supabase
    .from("read_state")
    .select("chat_id, last_read_message_id")
    .eq("user_id", state.user.id)
    .in("chat_id", chatIds);

  state.readStates = new Map();
  (readStates || []).forEach((row) => state.readStates.set(row.chat_id, row.last_read_message_id));

  const { data: latestMessages } = await supabase
    .from("messages")
    .select("chat_id, id, created_at, body, deleted_at, attachment_url")
    .in("chat_id", chatIds)
    .order("created_at", { ascending: false });

  const latestByChat = new Map();
  (latestMessages || []).forEach((row) => {
    if (!latestByChat.has(row.chat_id)) {
      latestByChat.set(row.chat_id, row);
    }
  });

  state.chats = memberships.map((member) => {
    const chat = member.chats;
    const membersForChat = state.membersByChat.get(chat.id) || [];
    const otherMember = membersForChat.find((m) => m.user_id !== state.user.id);
    const displayTitle = chat.type === "dm"
      ? (otherMember?.profiles?.display_name || chat.title || "Direct message")
      : (chat.title || "Untitled group");

    const latest = latestByChat.get(chat.id);
    const lastRead = state.readStates.get(chat.id);
    const unread = latest && latest.id !== lastRead;

    if (unread) {
      state.unreadChatIds.add(chat.id);
    }

    const latestPreview = latest?.deleted_at
      ? "Message deleted"
      : (latest?.body || (latest?.attachment_url ? "Attachment" : ""));

    return {
      id: chat.id,
      type: chat.type,
      title: chat.title,
      displayTitle,
      created_at: chat.created_at,
      latestPreview
    };
  });

  renderChatList();
  updateUnreadIndicator();
  subscribeInbox();
}

function subscribeInbox() {
  if (state.globalMessageChannel) {
    supabase.removeChannel(state.globalMessageChannel);
  }
  if (!state.chats.length) {
    return;
  }
  state.globalMessageChannel = supabase
    .channel("inbox")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      handleInboxMessage(payload);
    })
    .subscribe();
}

function handleInboxMessage(payload) {
  const message = payload.new;
  const chat = state.chats.find((item) => item.id === message.chat_id);
  if (!chat) {
    loadChats();
    return;
  }

  chat.latestPreview = message.deleted_at
    ? "Message deleted"
    : (message.body || (message.attachment_url ? "Attachment" : ""));

  const shouldUnread = message.user_id !== state.user.id &&
    (message.chat_id !== state.currentChatId || document.hidden || !isScrolledToBottom());
  if (shouldUnread) {
    state.unreadChatIds.add(message.chat_id);
  } else {
    state.unreadChatIds.delete(message.chat_id);
  }

  renderChatList();
  updateUnreadIndicator();
}

function renderChatList() {
  const filter = (els.chatSearch.value || "").toLowerCase();
  els.chatList.innerHTML = "";

  state.chats
    .filter((chat) => chat.displayTitle.toLowerCase().includes(filter))
    .forEach((chat) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      if (chat.id === state.currentChatId) {
        item.classList.add("active");
      }
      if (state.unreadChatIds.has(chat.id)) {
        item.classList.add("unread");
      }

      item.innerHTML = `
        <div>${escapeHtml(chat.displayTitle)}</div>
        <div class="muted">${escapeHtml(chat.latestPreview || "No messages yet")}</div>
      `;
      item.addEventListener("click", () => openChat(chat.id));
      els.chatList.appendChild(item);
    });
}

async function openChat(chatId) {
  if (state.currentChatId === chatId) {
    return;
  }
  state.currentChatId = chatId;
  state.messages = new Map();
  state.reactions = new Map();
  state.page = 0;
  state.hasMore = true;
  state.searchActive = false;
  state.replyingToId = null;
  state.editingId = null;
  clearComposerPreview();
  clearAttachmentPreview();

  const chat = state.chats.find((item) => item.id === chatId);
  els.chatTitle.textContent = chat?.displayTitle || "Chat";

  const members = state.membersByChat.get(chatId) || [];
  await loadMessages({ reset: true });
  await loadChatReadStates();
  renderChatSubtitle();
  subscribeToChat(chatId);
  markChatRead();

  state.unreadChatIds.delete(chatId);
  renderChatList();
  updateUnreadIndicator();
}

async function loadChatReadStates() {
  if (!state.currentChatId) {
    return;
  }
  const { data } = await supabase
    .from("read_state")
    .select("user_id, last_read_message_id")
    .eq("chat_id", state.currentChatId);

  state.chatReadStates = new Map();
  (data || []).forEach((row) => state.chatReadStates.set(row.user_id, row.last_read_message_id));
}

function renderChatSubtitle() {
  if (!state.currentChatId) {
    return;
  }
  const members = state.membersByChat.get(state.currentChatId) || [];
  const names = members.map((member) => member.profiles?.display_name || "Someone");
  const latest = getLatestMessage();
  let seenText = "";
  if (latest) {
    const others = members.filter((member) => member.user_id !== state.user.id);
    const seenCount = others.filter((member) => state.chatReadStates.get(member.user_id) === latest.id).length;
    if (others.length > 0) {
      seenText = `${seenCount}/${others.length} seen`;
    }
  }
  els.chatSubtitle.textContent = [names.join(" / "), seenText].filter(Boolean).join(" / ");
}

async function loadMessages({ reset = false } = {}) {
  if (state.loadingMessages || !state.currentChatId || !state.hasMore) {
    return;
  }
  if (state.searchActive && !reset) {
    return;
  }

  state.loadingMessages = true;

  const from = state.page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, chat_id, user_id, body, reply_to_message_id, attachment_url, attachment_type, edited_at, deleted_at, created_at, profiles(display_name, avatar_url), reply:reply_to_message_id(id, body, user_id, deleted_at, profiles(display_name))"
    )
    .eq("chat_id", state.currentChatId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    toast(error.message);
    state.loadingMessages = false;
    return;
  }

  const rows = data || [];
  if (rows.length < PAGE_SIZE) {
    state.hasMore = false;
  }

  rows.reverse().forEach((row) => {
    state.messages.set(row.id, row);
  });

  await loadReactions(rows.map((row) => row.id));
  renderMessages({ preserveScroll: !reset });

  if (reset) {
    scrollToBottom();
  }

  state.page += 1;
  state.loadingMessages = false;
}

async function fetchMessageById(messageId) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, chat_id, user_id, body, reply_to_message_id, attachment_url, attachment_type, edited_at, deleted_at, created_at, profiles(display_name, avatar_url), reply:reply_to_message_id(id, body, user_id, deleted_at, profiles(display_name))"
    )
    .eq("id", messageId)
    .maybeSingle();

  if (error) {
    toast(error.message);
    return null;
  }
  return data;
}

async function loadReactions(messageIds) {
  if (!messageIds.length) {
    return;
  }
  const { data } = await supabase
    .from("reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", messageIds);

  (data || []).forEach((reaction) => {
    if (!state.reactions.has(reaction.message_id)) {
      state.reactions.set(reaction.message_id, new Map());
    }
    const byEmoji = state.reactions.get(reaction.message_id);
    if (!byEmoji.has(reaction.emoji)) {
      byEmoji.set(reaction.emoji, new Set());
    }
    byEmoji.get(reaction.emoji).add(reaction.user_id);
  });
}

function renderMessages({ preserveScroll = false } = {}) {
  const isAtBottom = isScrolledToBottom();
  const previousHeight = els.messageList.scrollHeight;
  const previousTop = els.messageList.scrollTop;

  els.messageList.innerHTML = "";
  els.messageList.appendChild(els.scrollAnchor);

  const ordered = Array.from(state.messages.values()).sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );

  ordered.forEach((message) => {
    els.messageList.appendChild(createMessageElement(message));
  });

  if (preserveScroll) {
    const heightDiff = els.messageList.scrollHeight - previousHeight;
    els.messageList.scrollTop = previousTop + heightDiff;
  } else if (isAtBottom) {
    scrollToBottom();
  }
}

function createMessageElement(message) {
  const container = document.createElement("div");
  container.className = "message";
  container.dataset.id = message.id;

  const isSelf = message.user_id === state.user.id;
  if (isSelf) {
    container.classList.add("is-self");
  }

  if (message.deleted_at) {
    container.classList.add("deleted");
  }

  const header = document.createElement("div");
  header.className = "message-header";

  const authorName = isSelf ? "You" : message.profiles?.display_name || "Someone";
  const timeLabel = formatTime(message.created_at);
  const editedLabel = message.edited_at ? "(edited)" : "";

  header.innerHTML = `<span>${escapeHtml(authorName)}</span><span>${timeLabel}</span><span>${editedLabel}</span>`;

  const body = document.createElement("div");
  body.className = "message-body";
  if (message.deleted_at) {
    body.textContent = "This message was deleted.";
  } else {
    body.textContent = message.body || "";
  }

  container.appendChild(header);

  if (message.reply) {
    const reply = document.createElement("div");
    reply.className = "muted";
    const replyName = message.reply.profiles?.display_name || "Someone";
    const replyText = message.reply.deleted_at ? "Deleted message" : (message.reply.body || "");
    reply.innerHTML = `Replying to <button data-action="jump" data-reply-id="${message.reply.id}">${escapeHtml(replyName)}</button>: ${escapeHtml(truncate(replyText, 80))}`;
    container.appendChild(reply);
  }

  container.appendChild(body);

  if (message.attachment_url) {
    const img = document.createElement("img");
    img.src = message.attachment_url;
    img.alt = "Attachment";
    img.className = "attachment-image";
    img.addEventListener("click", () => openLightbox(message.attachment_url));
    container.appendChild(img);
  }

  const actions = document.createElement("div");
  actions.className = "message-actions";

  if (!message.deleted_at) {
    const replyBtn = buildActionButton("Reply", "reply");
    actions.appendChild(replyBtn);

    if (isEditable(message)) {
      actions.appendChild(buildActionButton("Edit", "edit"));
    }
    if (isSelf) {
      actions.appendChild(buildActionButton("Delete", "delete"));
    }

    EMOJI_SET.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.textContent = emoji;
      btn.dataset.action = "react";
      btn.dataset.emoji = emoji;
      actions.appendChild(btn);
    });
  }

  container.appendChild(actions);

  const reactionRow = document.createElement("div");
  reactionRow.className = "reaction-row";
  const reactions = state.reactions.get(message.id);
  if (reactions) {
    reactions.forEach((userIds, emoji) => {
      const chip = document.createElement("span");
      chip.className = "reaction-chip";
      if (userIds.has(state.user.id)) {
        chip.classList.add("active");
      }
      chip.dataset.action = "react";
      chip.dataset.emoji = emoji;
      chip.innerHTML = `${emoji} ${userIds.size}`;
      reactionRow.appendChild(chip);
    });
  }
  container.appendChild(reactionRow);

  return container;
}

function buildActionButton(label, action) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.dataset.action = action;
  return btn;
}

async function handleSendMessage(event) {
  event.preventDefault();
  if (!state.currentChatId) {
    return;
  }

  const body = els.messageInput.value.trim();
  if (!body && !state.attachmentFile) {
    return;
  }

  let attachmentUrl = null;
  let attachmentType = null;

  if (state.attachmentFile) {
    const upload = await uploadAttachment(state.attachmentFile);
    if (!upload) {
      return;
    }
    attachmentUrl = upload.url;
    attachmentType = upload.type;
  }

  if (state.editingId) {
    const { error } = await supabase
      .from("messages")
      .update({ body, edited_at: new Date().toISOString() })
      .eq("id", state.editingId)
      .eq("user_id", state.user.id);

    if (error) {
      toast(error.message);
      return;
    }

    state.editingId = null;
    clearComposerPreview();
    els.messageInput.value = "";
    return;
  }

  const insert = {
    chat_id: state.currentChatId,
    user_id: state.user.id,
    body: body || null,
    reply_to_message_id: state.replyingToId,
    attachment_url: attachmentUrl,
    attachment_type: attachmentType
  };

  const { error } = await supabase.from("messages").insert(insert);
  if (error) {
    toast(error.message);
    return;
  }

  els.messageInput.value = "";
  state.replyingToId = null;
  clearComposerPreview();
  clearAttachmentPreview();
}

function handleComposerKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
}

function handleAttachment(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  if (!file.type.startsWith("image/")) {
    toast("Only images are supported right now.");
    event.target.value = "";
    return;
  }
  state.attachmentFile = file;
  state.attachmentPreviewUrl = URL.createObjectURL(file);
  els.attachmentPreview.classList.remove("hidden");
  els.attachmentPreview.innerHTML = `
    <img src="${state.attachmentPreviewUrl}" alt="Preview" class="attachment-image" />
    <span>Attachment ready: ${escapeHtml(file.name)}</span>
    <button type="button" id="remove-attachment">Remove</button>
  `;
  document.getElementById("remove-attachment").addEventListener("click", clearAttachmentPreview);
}

async function uploadAttachment(file) {
  const path = `${state.user.id}/${state.currentChatId}/${Date.now()}-${file.name}`;
  const { error } = await supabase.storage.from("chat-attachments").upload(path, file, {
    contentType: file.type,
    upsert: false
  });

  if (error) {
    toast(error.message);
    return null;
  }

  const { data } = supabase.storage.from("chat-attachments").getPublicUrl(path);
  return { url: data.publicUrl, type: file.type };
}

function clearAttachmentPreview() {
  if (state.attachmentPreviewUrl) {
    URL.revokeObjectURL(state.attachmentPreviewUrl);
  }
  state.attachmentFile = null;
  state.attachmentPreviewUrl = null;
  els.attachmentInput.value = "";
  els.attachmentPreview.classList.add("hidden");
  els.attachmentPreview.innerHTML = "";
}

function handleMessageListClick(event) {
  const action = event.target.dataset.action;
  if (!action) {
    return;
  }

  const messageEl = event.target.closest(".message");
  const messageId = messageEl?.dataset.id;
  const message = state.messages.get(messageId);
  if (!message) {
    return;
  }

  if (action === "reply") {
    state.replyingToId = message.id;
    state.editingId = null;
    showReplyPreview(message);
  }

  if (action === "edit") {
    state.editingId = message.id;
    state.replyingToId = null;
    els.messageInput.value = message.body || "";
    els.messageInput.focus();
    showEditPreview(message);
  }

  if (action === "delete") {
    softDeleteMessage(message.id);
  }

  if (action === "react") {
    const emoji = event.target.dataset.emoji;
    toggleReaction(message.id, emoji);
  }

  if (action === "jump") {
    const replyId = event.target.dataset.replyId;
    jumpToMessage(replyId);
  }
}

function showReplyPreview(message) {
  const name = message.profiles?.display_name || "Someone";
  const text = message.deleted_at ? "Deleted message" : message.body || "";
  els.replyPreview.classList.remove("hidden");
  els.replyPreview.innerHTML = `Replying to <strong>${escapeHtml(name)}</strong>: ${escapeHtml(truncate(text, 90))} <button type="button" id="cancel-reply">Cancel</button>`;
  document.getElementById("cancel-reply").addEventListener("click", clearComposerPreview);
}

function showEditPreview(message) {
  els.replyPreview.classList.remove("hidden");
  els.replyPreview.innerHTML = `Editing your message <button type="button" id="cancel-reply">Cancel</button>`;
  document.getElementById("cancel-reply").addEventListener("click", clearComposerPreview);
}

function clearComposerPreview() {
  els.replyPreview.classList.add("hidden");
  els.replyPreview.innerHTML = "";
  state.replyingToId = null;
  state.editingId = null;
}

async function softDeleteMessage(messageId) {
  if (!confirm("Delete this message?")) {
    return;
  }
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("user_id", state.user.id);
  if (error) {
    toast(error.message);
  }
}

async function toggleReaction(messageId, emoji) {
  if (!emoji) {
    return;
  }
  const current = state.reactions.get(messageId)?.get(emoji);
  const reacted = current && current.has(state.user.id);

  if (reacted) {
    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", state.user.id)
      .eq("emoji", emoji);
    if (error) {
      toast(error.message);
    }
  } else {
    const { error } = await supabase
      .from("reactions")
      .insert({ message_id: messageId, user_id: state.user.id, emoji });
    if (error) {
      toast(error.message);
    }
  }
}

function jumpToMessage(messageId) {
  const messageEl = els.messageList.querySelector(`[data-id="${messageId}"]`);
  if (messageEl) {
    messageEl.scrollIntoView({ behavior: "smooth", block: "center" });
    messageEl.classList.add("highlight");
    setTimeout(() => messageEl.classList.remove("highlight"), 1200);
  } else {
    toast("Message not loaded yet.");
  }
}

function isEditable(message) {
  if (message.user_id !== state.user.id) {
    return false;
  }
  const ageMs = Date.now() - new Date(message.created_at).getTime();
  return ageMs < 15 * 60 * 1000;
}

async function handleChatSearch(event) {
  event.preventDefault();
  const term = els.chatSearchInput.value.trim();
  if (!term || !state.currentChatId) {
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, chat_id, user_id, body, reply_to_message_id, attachment_url, attachment_type, edited_at, deleted_at, created_at, profiles(display_name, avatar_url), reply:reply_to_message_id(id, body, user_id, deleted_at, profiles(display_name))"
    )
    .eq("chat_id", state.currentChatId)
    .ilike("body", `%${term}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    toast(error.message);
    return;
  }

  state.searchActive = true;
  state.messages = new Map();
  (data || []).reverse().forEach((row) => state.messages.set(row.id, row));
  await loadReactions(Array.from(state.messages.keys()));
  renderMessages({ preserveScroll: false });
  els.chatSubtitle.textContent = `${data?.length || 0} results for "${term}"`;
}

function clearSearch() {
  if (!state.searchActive) {
    return;
  }
  els.chatSearchInput.value = "";
  state.searchActive = false;
  state.page = 0;
  state.hasMore = true;
  state.messages = new Map();
  loadMessages({ reset: true });
}

function subscribeToChat(chatId) {
  cleanupSubscriptions();

  state.messageChannel = supabase
    .channel(`chat:${chatId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      (payload) => {
        void handleMessageChange(payload);
      }
    )
    .subscribe();

  state.reactionChannel = supabase
    .channel(`reactions:${chatId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, (payload) =>
      handleReactionChange(payload)
    )
    .subscribe();

  state.readChannel = supabase
    .channel(`read:${chatId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "read_state", filter: `chat_id=eq.${chatId}` },
      (payload) => handleReadChange(payload)
    )
    .subscribe();

  state.typingChannel = supabase.channel(`typing:${chatId}`, {
    config: { presence: { key: state.user.id } }
  });

  state.typingChannel
    .on("presence", { event: "sync" }, () => {
      const presenceState = state.typingChannel.presenceState();
      const typingUsers = Object.values(presenceState)
        .flat()
        .filter((p) => p.typing && p.user_id !== state.user.id)
        .map((p) => p.name || "Someone");
      updateTypingIndicator(typingUsers);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await state.typingChannel.track({
          typing: false,
          user_id: state.user.id,
          name: state.profile?.display_name || "Someone"
        });
      }
    });
}

function cleanupSubscriptions() {
  [state.messageChannel, state.reactionChannel, state.readChannel, state.typingChannel].forEach((channel) => {
    if (channel) {
      supabase.removeChannel(channel);
    }
  });
  state.messageChannel = null;
  state.reactionChannel = null;
  state.readChannel = null;
  state.typingChannel = null;
}

async function handleMessageChange(payload) {
  const { eventType, new: newRow, old } = payload;
  if (eventType === "INSERT" || eventType === "UPDATE") {
    const hydrated = await fetchMessageById(newRow.id);
    if (!hydrated) {
      return;
    }
    state.messages.set(newRow.id, hydrated);
    await loadReactions([newRow.id]);
    renderMessages({ preserveScroll: true });
  }

  if (eventType === "DELETE") {
    state.messages.delete(old.id);
    renderMessages({ preserveScroll: true });
  }

  markChatRead();
}

function handleReactionChange(payload) {
  const { eventType, new: newRow, old } = payload;
  const messageId = newRow?.message_id || old?.message_id;
  if (!state.messages.has(messageId)) {
    return;
  }

  if (!state.reactions.has(messageId)) {
    state.reactions.set(messageId, new Map());
  }

  const map = state.reactions.get(messageId);

  if (eventType === "INSERT") {
    if (!map.has(newRow.emoji)) {
      map.set(newRow.emoji, new Set());
    }
    map.get(newRow.emoji).add(newRow.user_id);
  }

  if (eventType === "DELETE") {
    if (map.has(old.emoji)) {
      map.get(old.emoji).delete(old.user_id);
      if (map.get(old.emoji).size === 0) {
        map.delete(old.emoji);
      }
    }
  }

  renderMessages({ preserveScroll: true });
}

function handleReadChange(payload) {
  if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
    if (payload.new.chat_id === state.currentChatId) {
      state.chatReadStates.set(payload.new.user_id, payload.new.last_read_message_id);
      renderChatSubtitle();
    }
    state.readStates.set(payload.new.chat_id, payload.new.last_read_message_id);
  }
}

function getLatestMessage() {
  return Array.from(state.messages.values()).sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  )[0];
}

async function markChatRead(force = false) {
  if (!state.currentChatId) {
    return;
  }
  if (!force && !isScrolledToBottom()) {
    return;
  }
  const latest = getLatestMessage();
  if (!latest) {
    return;
  }

  state.readStates.set(state.currentChatId, latest.id);
  state.chatReadStates.set(state.user.id, latest.id);
  state.unreadChatIds.delete(state.currentChatId);
  updateUnreadIndicator();
  renderChatSubtitle();

  await supabase
    .from("read_state")
    .upsert({
      chat_id: state.currentChatId,
      user_id: state.user.id,
      last_read_message_id: latest.id,
      updated_at: new Date().toISOString()
    }, { onConflict: "chat_id,user_id" });
}

function handleTyping() {
  if (!state.typingChannel) {
    return;
  }
  if (state.typingTimeout) {
    clearTimeout(state.typingTimeout);
  }

  state.typingChannel.track({
    typing: true,
    user_id: state.user.id,
    name: state.profile?.display_name || "Someone"
  });

  state.typingTimeout = setTimeout(() => {
    state.typingChannel.track({
      typing: false,
      user_id: state.user.id,
      name: state.profile?.display_name || "Someone"
    });
  }, 1600);
}

function updateTypingIndicator(names) {
  if (!names.length) {
    els.typingIndicator.textContent = "";
    return;
  }
  const unique = Array.from(new Set(names));
  els.typingIndicator.textContent = `${unique.join(", ")} typing...`;
}

function setupScrollObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadMessages({ reset: false });
        }
      });
    },
    { root: els.messageList, threshold: 0.1 }
  );
  observer.observe(els.scrollAnchor);
}

function scrollToBottom() {
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function isScrolledToBottom() {
  return els.messageList.scrollTop + els.messageList.clientHeight >= els.messageList.scrollHeight - 20;
}

function toast(message) {
  const toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.textContent = message;
  els.toastContainer.appendChild(toastEl);
  setTimeout(() => toastEl.remove(), 4000);
}

function toggleModal(modal, open) {
  if (!modal) {
    return;
  }
  if (open) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    if (modal === els.settingsModal) {
      loadSettings();
    }
  } else {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal").forEach((modal) => toggleModal(modal, false));
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.getElementById("dm-panel").classList.toggle("hidden", tab !== "dm");
  document.getElementById("group-panel").classList.toggle("hidden", tab !== "group");
}

async function saveProfile() {
  const displayName = els.displayNameInput.value.trim();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", state.user.id);

  if (error) {
    toast(error.message);
    return;
  }

  state.profile.display_name = displayName;
  els.profileName.textContent = displayName || "Anonymous";
  els.profileAvatar.textContent = initials(displayName || "ME");
  toast("Profile updated.");
}

async function loadSettings() {
  if (!state.user) {
    return;
  }
  const { data } = await supabase
    .from("notification_settings")
    .select("push_enabled, email_enabled, quiet_hours_start, quiet_hours_end")
    .eq("user_id", state.user.id)
    .maybeSingle();

  if (!data) {
    await supabase.from("notification_settings").insert({ user_id: state.user.id });
  }

  const settings = data || { push_enabled: false, email_enabled: false };
  els.pushToggle.checked = !!settings.push_enabled;
  els.emailToggle.checked = !!settings.email_enabled;
  els.quietStart.value = settings.quiet_hours_start || "";
  els.quietEnd.value = settings.quiet_hours_end || "";

  const { data: mutes } = await supabase
    .from("chat_mutes")
    .select("chat_id, muted_until")
    .eq("user_id", state.user.id);

  state.mutedChats = new Map();
  (mutes || []).forEach((row) => state.mutedChats.set(row.chat_id, row.muted_until));
  renderMuteList();
}

async function handlePushToggle() {
  if (els.pushToggle.checked) {
    const ok = await enablePush();
    if (!ok) {
      els.pushToggle.checked = false;
      return;
    }
  } else {
    await disablePush();
  }
  await updateNotificationSettings();
}

async function handleEmailToggle() {
  await updateNotificationSettings();
}

async function saveQuietHours() {
  await updateNotificationSettings();
  toast("Quiet hours saved.");
}

async function updateNotificationSettings() {
  await supabase
    .from("notification_settings")
    .upsert({
      user_id: state.user.id,
      push_enabled: els.pushToggle.checked,
      email_enabled: els.emailToggle.checked,
      quiet_hours_start: els.quietStart.value || null,
      quiet_hours_end: els.quietEnd.value || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
}

async function enablePush() {
  if (!("serviceWorker" in navigator)) {
    toast("Service workers are not supported in this browser.");
    return false;
  }

  if (!config.PUSH_VAPID_PUBLIC_KEY) {
    toast("Missing PUSH_VAPID_PUBLIC_KEY in config.js.");
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Push permission not granted.");
    return false;
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.PUSH_VAPID_PUBLIC_KEY)
  });

  const payload = subscription.toJSON();
  await supabase.from("push_subscriptions").upsert(
    {
      user_id: state.user.id,
      endpoint: payload.endpoint,
      subscription: payload,
      updated_at: new Date().toISOString()
    },
    { onConflict: "endpoint" }
  );

  toast("Push enabled.");
  return true;
}

async function disablePush() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();
    await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  }
  toast("Push disabled.");
}

function renderMuteList() {
  els.muteList.innerHTML = "";
  state.chats.forEach((chat) => {
    const row = document.createElement("div");
    row.className = "search-item";

    const select = document.createElement("select");
    select.innerHTML = `
      <option value="">Unmuted</option>
      <option value="1">Mute 1h</option>
      <option value="8">Mute 8h</option>
      <option value="24">Mute 24h</option>
      <option value="9999">Mute always</option>
    `;

    const mutedUntil = state.mutedChats.get(chat.id);
    if (mutedUntil) {
      const diffHours = (new Date(mutedUntil) - Date.now()) / (1000 * 60 * 60);
      if (diffHours > 1000) {
        select.value = "9999";
      } else if (diffHours > 20) {
        select.value = "24";
      } else if (diffHours > 7) {
        select.value = "8";
      } else if (diffHours > 0) {
        select.value = "1";
      }
    }

    select.addEventListener("change", () => updateChatMute(chat.id, select.value));

    row.innerHTML = `<span>${escapeHtml(chat.displayTitle)}</span>`;
    row.appendChild(select);
    els.muteList.appendChild(row);
  });
}

async function updateChatMute(chatId, hours) {
  if (!hours) {
    await supabase.from("chat_mutes").delete().eq("chat_id", chatId).eq("user_id", state.user.id);
    state.mutedChats.delete(chatId);
    return;
  }
  const hoursValue = hours === "9999" ? 24 * 365 * 10 : Number(hours);
  const mutedUntil = new Date(Date.now() + hoursValue * 60 * 60 * 1000).toISOString();
  await supabase.from("chat_mutes").upsert(
    {
      chat_id: chatId,
      user_id: state.user.id,
      muted_until: mutedUntil
    },
    { onConflict: "chat_id,user_id" }
  );
  state.mutedChats.set(chatId, mutedUntil);
}

async function quickMuteChat() {
  if (!state.currentChatId) {
    return;
  }
  const existing = state.mutedChats.get(state.currentChatId);
  if (existing && new Date(existing) > new Date()) {
    await updateChatMute(state.currentChatId, "");
    toast("Chat unmuted.");
  } else {
    await updateChatMute(state.currentChatId, "1");
    toast("Chat muted for 1h.");
  }
}

async function searchProfiles(term, container, selection, multi) {
  const query = term.trim();
  container.innerHTML = "";
  if (query.length < 2) {
    return;
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .ilike("display_name", `%${query}%`)
    .limit(5);

  (data || [])
    .filter((profile) => profile.id !== state.user.id)
    .forEach((profile) => {
      const row = document.createElement("div");
      row.className = "search-item";
      row.innerHTML = `<span>${escapeHtml(profile.display_name)}</span>`;
      const button = document.createElement("button");
      button.textContent = multi ? "Add" : "Select";
      button.addEventListener("click", () => {
        if (multi) {
          selection.set(profile.id, profile);
          renderGroupSelection();
        } else {
          selection.clear();
          selection.add(profile.id);
        }
      });
      row.appendChild(button);
      container.appendChild(row);
    });
}

function renderGroupSelection() {
  els.groupSelected.innerHTML = "";
  groupSelection.forEach((profile) => {
    const chip = document.createElement("span");
    chip.className = "selected-chip";
    chip.textContent = profile.display_name;
    els.groupSelected.appendChild(chip);
  });
}

async function createDm() {
  const [userId] = Array.from(dmSelection.values());
  if (!userId) {
    toast("Select someone first.");
    return;
  }

  const { data: chat, error } = await supabase
    .from("chats")
    .insert({ type: "dm", created_by: state.user.id })
    .select()
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  const members = [
    { chat_id: chat.id, user_id: state.user.id, role: "member" },
    { chat_id: chat.id, user_id: userId, role: "member" }
  ];

  const { error: memberError } = await supabase.from("chat_members").insert(members);
  if (memberError) {
    toast(memberError.message);
    return;
  }

  toggleModal(els.newChatModal, false);
  dmSelection.clear();
  await loadChats();
  openChat(chat.id);
}

async function createGroup() {
  const title = els.groupTitle.value.trim();
  const members = Array.from(groupSelection.keys());
  if (!title) {
    toast("Add a group title.");
    return;
  }
  if (members.length === 0) {
    toast("Add at least one member.");
    return;
  }

  const { data: chat, error } = await supabase
    .from("chats")
    .insert({ type: "group", title, created_by: state.user.id })
    .select()
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  const allMembers = [
    { chat_id: chat.id, user_id: state.user.id, role: "admin" },
    ...members.map((id) => ({ chat_id: chat.id, user_id: id, role: "member" }))
  ];

  const { error: memberError } = await supabase.from("chat_members").insert(allMembers);
  if (memberError) {
    toast(memberError.message);
    return;
  }

  toggleModal(els.newChatModal, false);
  groupSelection.clear();
  els.groupTitle.value = "";
  els.groupSelected.innerHTML = "";
  await loadChats();
  openChat(chat.id);
}

function updateUnreadIndicator() {
  const count = state.unreadChatIds.size;
  const hasUnread = count > 0;
  els.notificationDot.classList.toggle("hidden", !hasUnread);
  setFavicon(hasUnread);
  document.title = hasUnread ? `(${count}) Monochat` : "Monochat";
}

function setFavicon(hasUnread) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(32, 32, 18, 0, Math.PI * 2);
  ctx.fill();
  if (hasUnread) {
    ctx.fillStyle = "#d21f1f";
    ctx.beginPath();
    ctx.arc(48, 16, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  const favicon = document.getElementById("favicon");
  favicon.href = canvas.toDataURL("image/png");
}

function openLightbox(url) {
  els.lightboxImage.src = url;
  toggleModal(els.lightbox, true);
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(text) {
  return text
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function truncate(text, length) {
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, length)}...`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
