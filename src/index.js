require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
const PORT = Number(process.env.PORT || 3000);
const ADMIN_SECRET = process.env.ADMIN_SECRET || "change-this-password";

if (!BOT_TOKEN || !CHANNEL_ID || !ADMIN_IDS.length) {
  console.error("Set BOT_TOKEN, CHANNEL_ID and ADMIN_IDS in .env");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json({limit: "1mb"}));
app.use(express.static("public"));

const drafts = new Map();
const schedules = new Map();

function admin(id) { return ADMIN_IDS.includes(String(id)); }
function validUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u.trim()); }
function auth(req, res, next) {
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(401).json({error:"Unauthorized"});
  next();
}
function buttonsMarkup(buttons=[]) {
  const rows = [];
  for (let i=0; i<buttons.length; i+=2) {
    rows.push(buttons.slice(i,i+2).map(b => Markup.button.url(b.text, b.url)));
  }
  return rows.length ? Markup.inlineKeyboard(rows) : undefined;
}
function normalizeButtons(buttons=[]) {
  return buttons.slice(0,12).filter(b => b && b.text && validUrl(b.url))
    .map(b => ({text:String(b.text).slice(0,40), url:b.url.trim()}));
}
async function publish(post) {
  const buttons = normalizeButtons(post.buttons);
  const extra = {
    caption: post.caption || undefined,
    parse_mode: "HTML",
    ...(buttonsMarkup(buttons) || {})
  };
  if (post.type === "video") {
    return bot.telegram.sendVideo(CHANNEL_ID, post.file_id, extra);
  }
  return bot.telegram.sendPhoto(CHANNEL_ID, post.file_id, extra);
}

// Telegram bot workflow
bot.start(ctx => {
  if (!admin(ctx.from.id)) return;
  ctx.reply(
`🎬 Media Button Pro

/new — create a post
/cancel — cancel
/id — show your ID

After /new, send a photo/video.
Then send buttons like:

▶️ WATCH | https://example.com
🌐 WEBSITE | https://example.com/site`
  );
});
bot.command("id", ctx => ctx.reply(`Your Telegram ID: ${ctx.from.id}`));
bot.command("cancel", ctx => { drafts.delete(ctx.from.id); ctx.reply("Draft cancelled."); });

bot.command("new", ctx => {
  if (!admin(ctx.from.id)) return;
  drafts.set(ctx.from.id, {step:"media"});
  ctx.reply("📤 Send the photo or video.");
});

bot.on(["photo","video"], async ctx => {
  if (!admin(ctx.from.id)) return;
  const d = drafts.get(ctx.from.id);
  if (!d || d.step !== "media") return ctx.reply("Use /new first.");

  if (ctx.message.video) {
    d.type = "video";
    d.file_id = ctx.message.video.file_id;
    d.caption = ctx.message.caption || "";
  } else {
    d.type = "photo";
    d.file_id = ctx.message.photo.at(-1).file_id;
    d.caption = ctx.message.caption || "";
  }
  d.step = "buttons";
  drafts.set(ctx.from.id, d);
  ctx.reply(
`✅ Media received.

Send one button per line:
Button Name | https://example.com

Maximum 12 buttons.
Send /skip to publish without buttons.`
  );
});

async function finishDraft(ctx, text) {
  const d = drafts.get(ctx.from.id);
  if (!d || d.step !== "buttons") return false;
  const buttons = text.split("\\n").map(x => {
    const i=x.lastIndexOf("|");
    return i>0 ? {text:x.slice(0,i).trim(),url:x.slice(i+1).trim()} : null;
  }).filter(Boolean);
  const good = normalizeButtons(buttons);
  if (text !== "/skip" && !good.length) {
    await ctx.reply("⚠️ Format invalid. Use: Button Name | https://example.com");
    return true;
  }
  try {
    await publish({...d, buttons: text==="/skip"?[]:good});
    drafts.delete(ctx.from.id);
    await ctx.reply("✅ Published to channel.");
  } catch(e) {
    console.error("Telegram publish error:", e);
    const msg = e?.response?.description || e?.description || e?.message || "Unknown Telegram error";
    await ctx.reply(`❌ Publish failed\\n\\nTelegram error: ${msg}\\n\\nCheck: Bot admin + Post Messages permission + CHANNEL_ID.`);
  }
  return true;
}
bot.on("text", ctx => {
  if (!admin(ctx.from.id)) return;
  finishDraft(ctx, ctx.message.text);
});

// Admin API
app.get("/api/health", (_,res)=>res.json({ok:true}));
app.post("/api/publish", auth, async (req,res)=>{
  const p=req.body;
  if (!["photo","video"].includes(p.type) || !p.file_id)
    return res.status(400).json({error:"type and file_id required"});
  try {
    const result=await publish({...p, buttons:normalizeButtons(p.buttons)});
    res.json({ok:true, message_id:result.message_id});
  } catch(e) {
    console.error("Telegram publish error:", e);
    const msg = e?.response?.description || e?.description || e?.message || "Unknown Telegram error";
    res.status(500).json({error: msg});
  }
});
app.post("/api/schedule", auth, (req,res)=>{
  const p=req.body;
  if (!p.file_id || !["photo","video"].includes(p.type) || !p.when)
    return res.status(400).json({error:"type, file_id and when are required"});
  const id=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  const when=Date.parse(p.when);
  if (!Number.isFinite(when) || when<=Date.now()) return res.status(400).json({error:"Invalid future time"});
  schedules.set(id,{...p,buttons:normalizeButtons(p.buttons),when});
  res.json({ok:true,id,when:new Date(when).toISOString()});
});
app.get("/api/schedules", auth, (_,res)=>res.json([...schedules.entries()].map(([id,p])=>({id,...p}))));
app.delete("/api/schedules/:id", auth, (req,res)=>{
  const ok=schedules.delete(req.params.id); res.json({ok});
});

// lightweight scheduler
setInterval(async ()=>{
  const now=Date.now();
  for (const [id,p] of schedules) {
    if (p.when<=now) {
      try { await publish(p); } catch(e) { console.error("Scheduled publish:",e); }
      schedules.delete(id);
    }
  }
},1000);

app.listen(PORT,()=>console.log(`Admin panel: http://localhost:${PORT}`));
bot.launch().then(()=>console.log("Telegram bot running"));
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
