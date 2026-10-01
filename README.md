# Telegram Media Button Pro v2

Features:
- Photo posts
- Video posts
- Up to 12 custom URL buttons
- 2 buttons per row
- Custom caption
- Web Admin Panel
- Live button preview
- Scheduled publishing
- Telegram Bot workflow
- Admin ID restriction
- Secret-protected web API

## Setup

1. Create a Telegram bot with @BotFather.
2. Add it as an administrator to your channel with permission to post.
3. Copy `.env.example` to `.env`.
4. Fill in:
   - BOT_TOKEN
   - CHANNEL_ID
   - ADMIN_IDS
   - ADMIN_SECRET
5. Install:
   npm install
6. Start:
   npm start
7. Open:
   http://localhost:3000

## Easiest publishing workflow

Open Telegram and send:

/new

Then send a photo/video.

Then:

▶️ WATCH NOW | https://example.com/watch
🌐 WEBSITE | https://example.com
📥 DOWNLOAD | https://example.com/download

The bot publishes the media with the buttons.

## Web panel

The web panel is useful when you already have Telegram `file_id` values. It provides:
- button builder
- live preview
- caption
- publish now
- schedule

## Important

The panel does not replace Telegram's native video player. Telegram controls the native media player. This project adds the custom inline URL buttons underneath/around the media message.

For production, use HTTPS, a strong ADMIN_SECRET, and a persistent database/queue for scheduled posts.
