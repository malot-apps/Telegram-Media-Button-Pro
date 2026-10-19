# Telegram Media Button Pro v3

### Features
- Telegram `/new` photo/video workflow retained.
- Web admin panel can upload photo/video and publish immediately.
- Up to 12 custom URL buttons, editable labels/URLs, drag/drop reorder, 1/2/3-column row layout, and live preview.
- Save/reuse/delete button templates.
- Click tracking and analytics dashboard.
- Multi-channel targeting via `CHANNELS`.
- Scheduled posts using Telegram `file_id`.

### Render setup
1. Upload project files to GitHub. Do not upload `.env`.
2. Render Web Service: Build command `npm install`; Start command `npm start`.
3. Add Environment Variables:
   - `BOT_TOKEN`: token from @BotFather
   - `CHANNEL_ID`: default channel ID, e.g. `-1003980723831`
   - `CHANNELS`: optional comma-separated channel IDs/usernames; include every channel the bot is allowed to post to
   - `ADMIN_IDS`: your Telegram numeric user ID
   - `ADMIN_SECRET`: strong secret password
   - `PUBLIC_BASE_URL`: your full HTTPS Render URL, e.g. `https://telegram-media-button-pro.onrender.com`
   - `PORT`: usually let Render provide it; default is 3000
4. Add bot as administrator to every channel and enable Post Messages.
5. Open Render URL, enter `ADMIN_SECRET`, then use Composer.

### Bot flow
Send `/new`, send photo/video, then send `Button label | https://example.com` lines.

### Notes
- Telegram's native video player cannot be redesigned; inline buttons are attached to the message.
- Click tracking needs `PUBLIC_BASE_URL` set to the service's public HTTPS URL.
- Store file is `data/store.json`. Render's ephemeral filesystem can lose analytics, templates and schedules after restarts/redeploys. Attach a persistent disk and set `DATA_DIR` to its mount path for durable data.
- Scheduling requires `file_id`; direct web upload is for immediate publishing. Obtain a file_id by sending media to the bot via `/new`.
- Web uploads are limited to 50 MB in this implementation.
