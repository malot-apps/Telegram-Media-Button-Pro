require('dotenv').config();
const express = require('express'),
  multer = require('multer'),
  fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const { Telegraf, Markup } = require('telegraf');
const { fetchBloggerFeed, cleanHtml, escapeTelegramHtml, normalizeUrl } = require('./blogger');

const TOKEN = (process.env.BOT_TOKEN || '').trim();
const DEFAULT = (process.env.CHANNEL_ID || '').trim();
const ADMINS = (process.env.ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const SECRET = process.env.ADMIN_SECRET || 'admin';
const PORT = Number(process.env.PORT || 3000);
const rawChannels = (process.env.CHANNELS || '').split(',').map(x => x.trim()).filter(Boolean);
const CHANNELS = [...new Set([...rawChannels, ...(DEFAULT ? [DEFAULT] : (rawChannels.length ? [] : ['@demo_channel']))])];

if (!TOKEN || !process.env.ADMIN_SECRET) {
  console.warn('[AI Studio] Notice: BOT_TOKEN or ADMIN_SECRET not set in environment.');
  if (!process.env.ADMIN_SECRET) {
    console.log('[AI Studio] Using default ADMIN_SECRET="admin" for web dashboard authentication.');
  }
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const DATA = process.env.DATA_DIR || path.join(__dirname, '../data');
const UP = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UP, { recursive: true });

const DB = path.join(DATA, 'store.json');
const fresh = () => ({
  clicks: {},
  events: [],
  schedules: {},
  templates: {},
  blogger: {
    enabled: false,
    url: process.env.BLOGGER_URL || '',
    channelId: process.env.CHANNEL_ID || '',
    intervalMinutes: 15,
    readButtonText: '📖 Read Full Article',
    summaryLength: 300,
    footerText: '',
    initialPolicy: 'latest', // 'latest' = publish 1 newest on first sync, 'future' = mark existing as seen
    fixedButtons: [
      { id: crypto.randomUUID(), text: '📢 Join Channel', url: 'https://t.me/telegram', row: 1 }
    ],
    lastSync: null,
    lastStatus: 'Configured and ready',
    lastError: null,
    totalPublished: 0,
    publishedIds: [],
    history: []
  }
});

let db;
try {
  const loaded = JSON.parse(fs.readFileSync(DB, 'utf8'));
  db = {
    ...fresh(),
    ...loaded,
    blogger: {
      ...fresh().blogger,
      ...(loaded.blogger || {})
    }
  };
} catch {
  db = fresh();
}

function save() {
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
}

function resolveDirectUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let current = url.trim();
  // Unwrap nested /r/ tracking URLs if they exist in legacy data
  for (let i = 0; i < 5; i++) {
    const match = current.match(/\/r\/([a-zA-Z0-9_-]+)/);
    if (match && match[1] && db && db.clicks && db.clicks[match[1]] && db.clicks[match[1]].target) {
      current = db.clicks[match[1]].target.trim();
    } else {
      break;
    }
  }
  return current;
}

function sanitizeDatabaseUrls() {
  let changed = false;

  // 1. Sanitize button templates
  if (db.templates && typeof db.templates === 'object') {
    for (const t of Object.values(db.templates)) {
      if (Array.isArray(t.buttons)) {
        for (const b of t.buttons) {
          if (b && b.url) {
            const clean = resolveDirectUrl(b.url);
            if (clean !== b.url) {
              b.url = clean;
              changed = true;
            }
          }
        }
      }
    }
  }

  // 2. Sanitize scheduled posts
  if (db.schedules && typeof db.schedules === 'object') {
    for (const s of Object.values(db.schedules)) {
      if (Array.isArray(s.buttons)) {
        for (const b of s.buttons) {
          if (b && b.url) {
            const clean = resolveDirectUrl(b.url);
            if (clean !== b.url) {
              b.url = clean;
              changed = true;
            }
          }
        }
      }
    }
  }

  // 3. Sanitize blogger fixed buttons
  if (db.blogger && Array.isArray(db.blogger.fixedButtons)) {
    for (const b of db.blogger.fixedButtons) {
      if (b && b.url) {
        const clean = resolveDirectUrl(b.url);
        if (clean !== b.url) {
          b.url = clean;
          changed = true;
        }
      }
    }
  }

  if (changed) {
    console.log('[AI Studio] Cleaned legacy redirect URLs from database');
    save();
  }
}

// Sanitize legacy stored URLs immediately upon load
sanitizeDatabaseUrls();

const upload = multer({
  dest: UP,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (r, f, cb) => cb((/^image\//.test(f.mimetype) || /^video\//.test(f.mimetype)) ? null : new Error('Only photo/video files are supported.'))
});

const auth = (req, res, next) => {
  if (req.headers['x-admin-secret'] !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized: check Admin Secret' });
  }
  next();
};

const validUrl = u => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

function buttonsSafe(arr = []) {
  return (Array.isArray(arr) ? arr : [])
    .slice(0, 12)
    .map((b, i) => {
      if (!b) return null;
      const cleanUrl = resolveDirectUrl(b.url);
      const text = String(b.text || '').trim().slice(0, 40);
      if (!text || !validUrl(cleanUrl)) return null;
      return {
        id: String(b.id || crypto.randomUUID()),
        text,
        url: cleanUrl,
        row: Math.max(0, Math.min(20, Number(b.row ?? Math.floor(i / 2))))
      };
    })
    .filter(Boolean);
}

function keyboard(arr) {
  if (!arr || !arr.length) return undefined;
  const rows = {};
  for (const b of arr) {
    const directUrl = resolveDirectUrl(b.url);
    if (!validUrl(directUrl)) continue;
    const r = Math.max(0, Math.min(20, Number(b.row ?? 0)));
    (rows[r] ??= []).push(Markup.button.url(b.text, directUrl));
  }
  return Object.keys(rows).length
    ? Markup.inlineKeyboard(Object.keys(rows).sort((a, b) => a - b).map(k => rows[k]))
    : undefined;
}

async function publish(p, file) {
  const kb = keyboard(buttonsSafe(p.buttons));
  const extra = { caption: String(p.caption || '').slice(0, 1024) || undefined, ...(kb || {}) };
  const targets = p.targets?.length ? p.targets : (DEFAULT ? [DEFAULT] : [CHANNELS[0]]);
  let last;

  for (const target of targets) {
    if (!CHANNELS.includes(target)) {
      CHANNELS.push(target);
    }
    if (!bot || !TOKEN) {
      console.log(`[Preview Simulation] Post published to ${target}:`, {
        type: p.type,
        caption: p.caption,
        buttonsCount: (p.buttons || []).length,
        file: file ? file.originalname : p.file_id
      });
      last = { message_id: Math.floor(Math.random() * 900000 + 100000) };
      continue;
    }
    if (file) {
      const source = { source: file.path };
      last = p.type === 'video' ? await bot.telegram.sendVideo(target, source, extra) : await bot.telegram.sendPhoto(target, source, extra);
    } else {
      if (!p.file_id) throw Error('A Telegram file_id is required');
      last = p.type === 'video' ? await bot.telegram.sendVideo(target, p.file_id, extra) : await bot.telegram.sendPhoto(target, p.file_id, extra);
    }
  }
  return last;
}

// ==========================================
// BLOGGER AUTO-PUBLISHER FUNCTIONS
// ==========================================

function bloggerKeyboard(post, fixedButtons = [], readButtonText = '📖 Read Full Article') {
  const rows = {};

  // 1. Dynamic button linking directly to the original Blogger post URL
  const articleUrl = resolveDirectUrl(post.link);
  if (validUrl(articleUrl)) {
    (rows[0] ??= []).push(Markup.button.url(readButtonText || '📖 Read Full Article', articleUrl));
  }

  // 2. Fixed inline buttons linking directly to their destination URLs
  for (const b of (fixedButtons || [])) {
    if (!b || !b.text) continue;
    const directUrl = resolveDirectUrl(b.url);
    if (!validUrl(directUrl)) continue;
    const r = Math.max(1, Math.min(10, Number(b.row || 1)));
    (rows[r] ??= []).push(Markup.button.url(String(b.text).trim().slice(0, 40), directUrl));
  }

  return Object.keys(rows).length
    ? Markup.inlineKeyboard(Object.keys(rows).sort((a, b) => a - b).map(k => rows[k]))
    : undefined;
}

async function publishBloggerPost(post) {
  const targetChannel = (db.blogger.channelId || DEFAULT || CHANNELS[0] || '').trim();
  if (!targetChannel) {
    throw new Error('No Telegram channel configured for Blogger Auto-Publisher');
  }

  if (!CHANNELS.includes(targetChannel)) {
    CHANNELS.push(targetChannel);
  }

  const readBtnText = db.blogger.readButtonText || '📖 Read Full Article';
  const kb = bloggerKeyboard(post, db.blogger.fixedButtons, readBtnText);

  // Build clean caption
  let caption = `<b>${escapeTelegramHtml(post.title)}</b>\n\n${escapeTelegramHtml(post.summary)}`;
  if (db.blogger.footerText && db.blogger.footerText.trim()) {
    caption += `\n\n${escapeTelegramHtml(db.blogger.footerText.trim())}`;
  }
  // Clamp caption to 1020 chars max (Telegram caption limit is 1024)
  if (caption.length > 1020) {
    caption = caption.slice(0, 1017) + '...';
  }

  let sent;
  if (!bot || !TOKEN) {
    console.log(`[Preview Simulation] Auto-publishing Blogger post to ${targetChannel}:`, {
      title: post.title,
      link: post.link,
      hasImage: !!post.imageUrl
    });
    sent = { message_id: Math.floor(Math.random() * 900000 + 100000) };
  } else {
    if (post.imageUrl) {
      try {
        sent = await bot.telegram.sendPhoto(targetChannel, post.imageUrl, {
          caption,
          parse_mode: 'HTML',
          ...kb
        });
      } catch (photoErr) {
        console.warn('[Blogger Auto-Publisher] sendPhoto failed with image URL, sending message text fallback:', photoErr.message);
        sent = await bot.telegram.sendMessage(targetChannel, caption, {
          parse_mode: 'HTML',
          ...kb,
          link_preview_options: { is_disabled: false }
        });
      }
    } else {
      sent = await bot.telegram.sendMessage(targetChannel, caption, {
        parse_mode: 'HTML',
        ...kb,
        link_preview_options: { is_disabled: false }
      });
    }
  }

  return sent;
}

let isSyncingBlogger = false;
async function checkAndPublishBlogger(force = false) {
  if (isSyncingBlogger) {
    return { ok: false, error: 'Sync already in progress' };
  }
  if (!db.blogger || (!db.blogger.enabled && !force)) {
    return { ok: false, message: 'Blogger auto-publisher is disabled' };
  }
  if (!db.blogger.url) {
    return { ok: false, error: 'No Blogger URL configured' };
  }

  isSyncingBlogger = true;
  try {
    console.log(`[Blogger Auto-Publisher] Checking feed: ${db.blogger.url}`);
    const feed = await fetchBloggerFeed(db.blogger.url);
    if (!feed.items || !feed.items.length) {
      db.blogger.lastSync = new Date().toISOString();
      db.blogger.lastStatus = 'Checked: No posts found in feed';
      db.blogger.lastError = null;
      save();
      return { ok: true, found: 0, published: 0, message: 'No posts found in feed' };
    }

    if (!Array.isArray(db.blogger.publishedIds)) {
      db.blogger.publishedIds = [];
    }
    if (!Array.isArray(db.blogger.history)) {
      db.blogger.history = [];
    }

    // Initial run check
    if (db.blogger.publishedIds.length === 0) {
      if (db.blogger.initialPolicy === 'future') {
        db.blogger.publishedIds = feed.items.map(it => it.id || it.link);
        db.blogger.lastSync = new Date().toISOString();
        db.blogger.lastStatus = `Initial sync: marked ${feed.items.length} existing posts as seen. Waiting for new posts.`;
        db.blogger.lastError = null;
        save();
        return { ok: true, found: feed.items.length, published: 0, message: db.blogger.lastStatus };
      } else {
        const newest = feed.items[0];
        db.blogger.publishedIds = feed.items.map(it => it.id || it.link);
        const sent = await publishBloggerPost(newest);

        db.blogger.history.unshift({
          id: newest.id || newest.link,
          title: newest.title,
          url: newest.link,
          publishedAt: newest.published,
          telegramMessageId: sent.message_id,
          channel: db.blogger.channelId || DEFAULT || CHANNELS[0],
          at: new Date().toISOString()
        });
        if (db.blogger.history.length > 50) db.blogger.history = db.blogger.history.slice(0, 50);

        db.blogger.totalPublished = (db.blogger.totalPublished || 0) + 1;
        db.blogger.lastSync = new Date().toISOString();
        db.blogger.lastStatus = `Initial sync: published newest post "${newest.title}"`;
        db.blogger.lastError = null;
        save();
        return { ok: true, found: feed.items.length, published: 1, message: db.blogger.lastStatus };
      }
    }

    // Subsequent runs: detect new posts that haven't been published yet
    const unseenPosts = feed.items.filter(it => {
      const key = it.id || it.link;
      return !db.blogger.publishedIds.includes(key);
    });

    if (!unseenPosts.length) {
      db.blogger.lastSync = new Date().toISOString();
      db.blogger.lastStatus = `Checked at ${new Date().toLocaleTimeString()}: Everything up to date (${feed.items.length} posts checked)`;
      db.blogger.lastError = null;
      save();
      return { ok: true, found: feed.items.length, published: 0, message: 'All posts already published' };
    }

    // Publish in chronological order (oldest to newest), max 5 per run
    const toPublish = unseenPosts.reverse().slice(-5);
    let publishedCount = 0;

    for (const post of toPublish) {
      try {
        const sent = await publishBloggerPost(post);
        const key = post.id || post.link;
        db.blogger.publishedIds.push(key);
        if (db.blogger.publishedIds.length > 1000) {
          db.blogger.publishedIds = db.blogger.publishedIds.slice(-1000);
        }

        db.blogger.history.unshift({
          id: key,
          title: post.title,
          url: post.link,
          publishedAt: post.published,
          telegramMessageId: sent.message_id,
          channel: db.blogger.channelId || DEFAULT || CHANNELS[0],
          at: new Date().toISOString()
        });
        if (db.blogger.history.length > 50) db.blogger.history = db.blogger.history.slice(0, 50);

        db.blogger.totalPublished = (db.blogger.totalPublished || 0) + 1;
        publishedCount++;

        // Rate limit pause between Telegram posts (1.5 seconds)
        await new Promise(r => setTimeout(r, 1500));
      } catch (postErr) {
        console.error(`[Blogger Auto-Publisher] Failed to publish post "${post.title}":`, postErr.message);
      }
    }

    db.blogger.lastSync = new Date().toISOString();
    db.blogger.lastStatus = `Published ${publishedCount} new post${publishedCount === 1 ? '' : 's'}`;
    db.blogger.lastError = null;
    save();
    return { ok: true, found: feed.items.length, published: publishedCount, message: db.blogger.lastStatus };
  } catch (err) {
    console.error('[Blogger Auto-Publisher] Sync failed:', err.message);
    db.blogger.lastSync = new Date().toISOString();
    db.blogger.lastError = err.message;
    db.blogger.lastStatus = 'Error during sync: ' + err.message;
    save();
    return { ok: false, error: err.message };
  } finally {
    isSyncingBlogger = false;
  }
}

let bloggerSchedulerTimer = null;
function setupBloggerScheduler() {
  if (bloggerSchedulerTimer) {
    clearInterval(bloggerSchedulerTimer);
    bloggerSchedulerTimer = null;
  }
  if (!db.blogger || !db.blogger.enabled || !db.blogger.url) {
    console.log('[Blogger Auto-Publisher] Automation is currently disabled or URL is empty.');
    return;
  }

  const mins = Math.max(1, Number(db.blogger.intervalMinutes || 15));
  const intervalMs = mins * 60 * 1000;
  console.log(`[Blogger Auto-Publisher] Scheduler active: checking every ${mins} minute(s)`);

  bloggerSchedulerTimer = setInterval(async () => {
    try {
      await checkAndPublishBlogger();
    } catch (e) {
      console.error('[Blogger Scheduler Loop Error]', e.message);
    }
  }, intervalMs);
}

// Start scheduler on launch
setTimeout(() => {
  setupBloggerScheduler();
  if (db.blogger && db.blogger.enabled && db.blogger.url) {
    console.log('[Blogger Auto-Publisher] Running initial check in 10 seconds...');
    setTimeout(() => {
      checkAndPublishBlogger().catch(e => console.error('[Blogger Startup Check Error]', e.message));
    }, 10000);
  }
}, 3000);

// ==========================================
// TELEGRAM BOT SETUP
// ==========================================

const drafts = new Map();
const isAdmin = id => !ADMINS.length || ADMINS.includes(String(id));

let bot = null;
if (TOKEN) {
  try {
    bot = new Telegraf(TOKEN);

    bot.start(ctx => {
      if (!isAdmin(ctx.from.id)) return;
      ctx.reply('🎬 Media Button Pro v3 + Blogger Auto Publisher\n/new — create post\n/cancel — cancel\n/id — show Telegram ID\n\nAfter /new send photo/video, then one button per line:\nWATCH NOW | https://example.com/watch\nWEBSITE | https://example.com\n\nMaximum 12 buttons. /skip publishes without buttons.');
    });

    bot.command('id', ctx => ctx.reply('Your Telegram ID: ' + ctx.from.id));
    bot.command('cancel', ctx => {
      drafts.delete(ctx.from.id);
      ctx.reply('Draft cancelled');
    });

    bot.command('new', ctx => {
      if (!isAdmin(ctx.from.id)) return;
      drafts.set(ctx.from.id, { step: 'media', targets: [DEFAULT || CHANNELS[0]] });
      ctx.reply('Send a photo or video now.');
    });

    bot.on(['photo', 'video'], ctx => {
      if (!isAdmin(ctx.from.id)) return;
      const d = drafts.get(ctx.from.id);
      if (!d || d.step !== 'media') return;
      if (ctx.message.video) {
        d.type = 'video';
        d.file_id = ctx.message.video.file_id;
        d.caption = ctx.message.caption || '';
      } else {
        d.type = 'photo';
        d.file_id = ctx.message.photo.at(-1).file_id;
        d.caption = ctx.message.caption || '';
      }
      d.step = 'buttons';
      drafts.set(ctx.from.id, d);
      ctx.reply('✅ Media received. Send one button per line:\nButton Name | https://example.com\nMaximum 12 buttons. Send /skip to publish without buttons.');
    });

    bot.on('text', async ctx => {
      if (!isAdmin(ctx.from.id)) return;
      const d = drafts.get(ctx.from.id);
      if (!d || d.step !== 'buttons') return;
      let bs = [];
      if (ctx.message.text !== '/skip') {
        bs = ctx.message.text.split('\n').map((s, i) => {
          const p = s.lastIndexOf('|');
          return p > 0 ? { text: s.slice(0, p).trim(), url: s.slice(p + 1).trim(), row: i } : null;
        }).filter(Boolean);
      }
      if (ctx.message.text !== '/skip' && !buttonsSafe(bs).length) {
        return ctx.reply('Invalid format. Use Button Name | https://example.com');
      }
      try {
        await publish({ ...d, buttons: bs });
        drafts.delete(ctx.from.id);
        ctx.reply('✅ Published to channel.');
      } catch (e) {
        console.error(e);
        ctx.reply('❌ Publish failed\nTelegram error: ' + (e?.response?.description || e.message));
      }
    });

    bot.launch()
      .then(() => console.log('Telegram bot running'))
      .catch(e => console.warn('[AI Studio] Telegram bot polling warning:', e.message));

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (err) {
    console.warn('[AI Studio] Failed to start Telegraf bot:', err.message);
  }
} else {
  console.log('[AI Studio] BOT_TOKEN not provided — Telegram polling disabled. Web dashboard active.');
}

// ==========================================
// REST API ROUTES
// ==========================================

app.get('/api/config', auth, (_, res) => res.json({ channels: CHANNELS }));

app.post('/api/publish', auth, async (req, res) => {
  try {
    const p = req.body;
    if (!['photo', 'video'].includes(p.type)) return res.status(400).json({ error: 'Choose photo or video type' });
    const m = await publish({ ...p, buttons: buttonsSafe(p.buttons) });
    res.json({ ok: true, message_id: m.message_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.response?.description || e.message });
  }
});

app.post('/api/upload-publish', auth, upload.single('media'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo or video' });
  try {
    const p = JSON.parse(req.body.post || '{}');
    p.type = req.file.mimetype.startsWith('video/') ? 'video' : 'photo';
    const m = await publish({ ...p, buttons: buttonsSafe(p.buttons) }, req.file);
    res.json({ ok: true, message_id: m.message_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.response?.description || e.message });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

app.post('/api/templates', auth, (req, res) => {
  if (!req.body.name || !Array.isArray(req.body.buttons)) {
    return res.status(400).json({ error: 'Template name and buttons required' });
  }
  const id = crypto.randomUUID();
  db.templates[id] = { id, name: String(req.body.name).slice(0, 60), buttons: buttonsSafe(req.body.buttons) };
  save();
  res.json({ ok: true, template: db.templates[id] });
});

app.get('/api/templates', auth, (_, res) => res.json(Object.values(db.templates)));

app.delete('/api/templates/:id', auth, (req, res) => {
  const ok = !!db.templates[req.params.id];
  delete db.templates[req.params.id];
  save();
  res.json({ ok });
});

app.get('/api/analytics', auth, (_, res) => {
  const links = Object.values(db.clicks).sort((a, b) => b.count - a.count);
  res.json({ totalClicks: links.reduce((n, x) => n + x.count, 0), links, recent: db.events.slice(-50).reverse() });
});

app.get('/r/:id', (req, res) => {
  const x = db.clicks[req.params.id];
  if (!x) return res.status(404).send('Tracking link not found');
  x.count++;
  db.events.push({ id: x.id, label: x.label, target: x.target, at: new Date().toISOString() });
  if (db.events.length > 5000) db.events = db.events.slice(-5000);
  save();
  res.redirect(302, x.target);
});

app.post('/api/schedule', auth, (req, res) => {
  const p = req.body, when = Date.parse(p.when);
  if (!p.file_id || !['photo', 'video'].includes(p.type) || !Number.isFinite(when) || when <= Date.now()) {
    return res.status(400).json({ error: 'Schedule requires photo/video type, Telegram file_id and future date/time' });
  }
  const id = crypto.randomUUID();
  db.schedules[id] = { ...p, buttons: buttonsSafe(p.buttons), when };
  save();
  res.json({ ok: true, id });
});

app.get('/api/schedules', auth, (_, res) => res.json(Object.entries(db.schedules).map(([id, p]) => ({ id, ...p }))));

app.delete('/api/schedules/:id', auth, (req, res) => {
  const ok = !!db.schedules[req.params.id];
  delete db.schedules[req.params.id];
  save();
  res.json({ ok });
});

// ==========================================
// BLOGGER AUTO-PUBLISHER API ROUTES
// ==========================================

app.get('/api/blogger/config', auth, (_, res) => {
  res.json({
    blogger: db.blogger,
    channels: CHANNELS
  });
});

app.post('/api/blogger/config', auth, (req, res) => {
  try {
    const b = req.body || {};
    db.blogger.enabled = Boolean(b.enabled);
    db.blogger.url = String(b.url || '').trim();
    db.blogger.channelId = String(b.channelId || '').trim();
    db.blogger.intervalMinutes = Math.max(1, Math.min(1440, Number(b.intervalMinutes || 15)));
    db.blogger.readButtonText = String(b.readButtonText || '📖 Read Full Article').trim().slice(0, 50);
    db.blogger.summaryLength = Math.max(50, Math.min(800, Number(b.summaryLength || 300)));
    db.blogger.footerText = String(b.footerText || '').trim().slice(0, 200);
    db.blogger.initialPolicy = ['latest', 'future'].includes(b.initialPolicy) ? b.initialPolicy : 'latest';

    // Validate and sanitize fixedButtons to ensure direct destination URLs only
    if (Array.isArray(b.fixedButtons)) {
      db.blogger.fixedButtons = b.fixedButtons
        .map((btn, idx) => {
          if (!btn) return null;
          const directUrl = resolveDirectUrl(btn.url);
          const text = String(btn.text || '').trim().slice(0, 40);
          if (!text || !validUrl(directUrl)) return null;
          return {
            id: String(btn.id || crypto.randomUUID()),
            text,
            url: directUrl,
            row: Math.max(1, Math.min(10, Number(btn.row ?? (Math.floor(idx / 2) + 1))))
          };
        })
        .filter(Boolean);
    }

    if (db.blogger.channelId && !CHANNELS.includes(db.blogger.channelId)) {
      CHANNELS.push(db.blogger.channelId);
    }

    save();
    setupBloggerScheduler();

    res.json({ ok: true, blogger: db.blogger, channels: CHANNELS });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/blogger/test', auth, async (req, res) => {
  try {
    const targetUrl = (req.body.url || db.blogger.url || '').trim();
    if (!targetUrl) {
      return res.status(400).json({ error: 'Please enter a Blogger URL to test' });
    }
    const feed = await fetchBloggerFeed(targetUrl);
    res.json({
      ok: true,
      blogTitle: feed.blogTitle,
      source: feed.source,
      feedUrl: feed.feedUrl,
      itemsCount: feed.items.length,
      sampleItems: feed.items.slice(0, 5)
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/blogger/sync', auth, async (req, res) => {
  try {
    const result = await checkAndPublishBlogger(true);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/blogger/reset-cache', auth, (req, res) => {
  try {
    db.blogger.publishedIds = [];
    db.blogger.history = [];
    db.blogger.lastStatus = 'Cache reset: ready for initial sync';
    db.blogger.lastError = null;
    save();
    res.json({ ok: true, message: 'Cache reset successfully' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (_, res) => res.json({ ok: true, version: '3.1.0' }));

// Scheduled posts runner loop
setInterval(async () => {
  for (const [id, p] of Object.entries(db.schedules)) {
    if (p.when <= Date.now()) {
      try {
        await publish(p);
      } catch (e) {
        console.error('Scheduled post failed', e?.response?.description || e.message);
      }
      delete db.schedules[id];
      save();
    }
  }
}, 5000);

app.use((e, req, res, next) => {
  console.error(e);
  res.status(400).json({ error: e.message || 'Request failed' });
});

app.listen(PORT, '0.0.0.0', () => console.log('Admin panel listening on http://0.0.0.0:' + PORT));
