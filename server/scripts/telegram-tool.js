#!/usr/bin/env node
/**
 * Telegram bot helper.
 *
 *   node --env-file=.env scripts/telegram-tool.js --me
 *   node --env-file=.env scripts/telegram-tool.js --updates
 *   node --env-file=.env scripts/telegram-tool.js --send --chat=123456789 --text="test"
 */
const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set');
  process.exit(2);
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error(`${method} failed:`, data.description ?? res.status);
    process.exit(1);
  }
  return data.result;
}

if (args.me) {
  const me = await call('getMe');
  console.log(JSON.stringify({ id: me.id, username: me.username, name: me.first_name, can_join_groups: me.can_join_groups }, null, 1));
} else if (args.updates) {
  const updates = await call('getUpdates?limit=100&timeout=0');
  const chats = new Map();
  for (const u of updates) {
    const chat = u.message?.chat ?? u.edited_message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (chat) chats.set(chat.id, { id: chat.id, type: chat.type, username: chat.username ?? null, name: [chat.first_name, chat.last_name, chat.title].filter(Boolean).join(' ') });
  }
  if (chats.size === 0) {
    console.log('Немає апдейтів. Нехай людина натисне /start у боті, потім запустіть команду ще раз.');
  } else {
    console.log('Знайдені чати:');
    for (const c of chats.values()) console.log(JSON.stringify(c));
  }
} else if (args.send) {
  if (!args.chat) { console.error('--chat=<id> is required'); process.exit(2); }
  const result = await call('sendMessage', { chat_id: args.chat, text: args.text || 'MarketApp: тестове повідомлення', disable_web_page_preview: true });
  console.log('sent:', JSON.stringify({ message_id: result.message_id, chat: result.chat?.id }));
} else {
  console.log('usage: --me | --updates | --send --chat=ID [--text=...]');
}
