# 🎬 Telegram Media Button Pro + Blogger Auto Publisher (v3.1)

A production-ready Telegram channel publisher and automated Google Blogger content syndication tool with customizable inline buttons, live click analytics, scheduling, and multi-channel targeting.

---

## ✨ Features

### 1. 🤖 Blogger RSS/JSON Feed Auto-Publisher
- **Automatic Background Synchronization**: Polls your Blogger blog at customizable intervals (1, 5, 10, 15, 30, 60, or 120 minutes) and publishes new articles directly to your Telegram channel.
- **Dual Feed Protocol Support**:
  - Native Blogger JSON API (`/feeds/posts/default?alt=json`)
  - Standard RSS/Atom XML feeds for custom-domain Blogger setups
- **Smart Duplicate Prevention**: Maintains a hash-set of published post IDs and permanent URLs to prevent duplicate publications.
- **High-Resolution Image Extraction**: Automatically detects post thumbnails and upgrades resolution to `/s1600/`, or extracts the lead `<img>` tag from HTML content.
- **Clean Summary Extraction**: Strips raw HTML, styles, and scripts; decodes HTML entities; and generates clean, readable summaries clamped to Telegram's 1024-character caption limits.
- **Dynamic "Read Article" Direct Button**: Generates a clean inline button linking directly to the original published post URL without any redirects or tracking pages.
- **Configurable Direct Fixed Inline Buttons**: Add custom inline buttons (e.g. *Join Channel*, *Visit Website*, *Community Chat*) to every auto-published post linking directly to their destination URLs.
- **First-Run Policy**: Choose between publishing only the single newest article on initial sync or marking existing articles as seen so only future posts are sent.
- **Feed Testing & Live Preview**: Real-time verification tool in the Admin Panel to inspect blog post titles, images, snippets, and button layout before enabling automation.

### 2. 📝 Manual Media Composer
- Direct upload of photos and videos (up to 50 MB) with immediate delivery.
- Direct destination URLs on all inline buttons (no Render redirects, tracking endpoints, or intermediate pages).
- Support for Telegram `file_id` for zero-bandwidth forwarding or scheduled posts.
- Drag-and-drop button reordering with 1, 2, or 3 buttons per row presets.
- Live interactive Telegram client preview.

### 3. 📚 Button Templates
- Save reusable button configurations and layouts.
- One-click template application in the Composer.

### 4. 📊 Analytics & Redirect Fallback
- Legacy `/r/:id` endpoint maintained for seamless backward-compatibility with past messages previously posted to channels.
- Real-time dashboard showing status and click records.

### 5. 🕐 Post Scheduling
- Schedule media posts for future dates and times using Telegram `file_id`.
- Automated background evaluation loop running every 5 seconds.

### 6. 💬 Direct Telegram Bot Commands
- `/start` — Help and command overview.
- `/new` — Step-by-step interactive post creator (send photo/video, then button labels and URLs).
- `/id` — Display your Telegram numerical ID.
- `/cancel` — Cancel any pending draft.

---

## 🛠️ Environment Variables Reference

| Variable | Required | Description | Example |
| :--- | :--- | :--- | :--- |
| `BOT_TOKEN` | Yes | Telegram Bot Token from [@BotFather](https://t.me/BotFather) | `123456789:ABCdefGhIJKlmNoP` |
| `CHANNEL_ID` | Yes | Default channel username or numeric ID (must start with `-100` if numeric) | `-1003980723831` or `@mychannel` |
| `ADMIN_SECRET` | Yes | Password for Admin Panel access | `your_secure_password_123` |
| `ADMIN_IDS` | Yes | Comma-separated numeric Telegram user IDs of allowed administrators | `2145249187,987654321` |
| `PUBLIC_BASE_URL`| Optional | Public HTTPS URL of your deployment (used for webhook / backward-compatible redirects) | `https://your-service.onrender.com` |
| `BLOGGER_URL` | Optional | Default Blogger site or feed URL (can also be configured via Admin Panel) | `https://yourblog.blogspot.com` |
| `CHANNELS` | Optional | Comma-separated list of additional channel IDs permitted for publishing | `-1001111111111,@channel2` |
| `PORT` | Optional | Web server port (defaults to 3000) | `3000` |
| `DATA_DIR` | Optional | Storage directory for persistent JSON database | `./data` or `/var/data` |

---

## 🚀 Deployment Guide on Render

### Step 1: Telegram Bot Preparation
1. Open [@BotFather](https://t.me/BotFather) on Telegram and create a new bot via `/newbot`. Copy the API token.
2. In your Telegram Channel:
   - Go to **Channel Settings** > **Administrators** > **Add Administrator**.
   - Search for your bot username and add it.
   - Grant the **Post Messages** permission.
3. Obtain your Telegram User ID using [@userinfobot](https://t.me/userinfobot) or by sending `/id` to your bot.

### Step 2: Deploy to Render
1. Push your repository to GitHub.
2. Log in to [Render Dashboard](https://dashboard.render.com/) and click **New +** > **Web Service**.
3. Select your repository.
4. Configure the build and runtime settings:
   - **Environment**: `Node`
   - **Node Version**: `22` (or default)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
5. Under **Environment Variables**, add:
   - `BOT_TOKEN` = `<your bot token>`
   - `CHANNEL_ID` = `<your channel id>`
   - `ADMIN_SECRET` = `<a strong password>`
   - `ADMIN_IDS` = `<your numeric telegram user id>`
   - `PUBLIC_BASE_URL` = `https://<your-render-app-name>.onrender.com`
6. Click **Deploy Web Service**.

### Step 3: Attach Persistent Disk (Recommended)
Render Web Services have ephemeral filesystems that reset on restarts or redeployments. To make sure your scheduled posts, click analytics, and Blogger deduplication cache persist forever:
1. In your Render Web Service dashboard, go to **Disks**.
2. Click **Add Disks**.
3. Set **Name** to `app-data`.
4. Set **Mount Path** to `/opt/render/project/src/data`.
5. Set **Size** to `1 GB`.
6. Add the environment variable: `DATA_DIR=/opt/render/project/src/data`.

---

## 💻 Local Development

1. Clone repository and install dependencies:
```bash
git clone <your-repo>
cd telegram-media-button-pro
npm install
```

2. Copy and configure `.env`:
```bash
cp .env.example .env
```

3. Start dev server:
```bash
npm run dev
```

4. Run syntax and integrity checks:
```bash
npm run lint
```

5. Open your browser at `http://localhost:3000`.

---

## 📖 Admin Panel Usage

1. Open your hosted URL in a web browser.
2. Enter your `ADMIN_SECRET` and click **Connect Admin**.
3. Switch to the **🤖 Blogger Auto-Publisher** tab:
   - Enter your Blogger URL (e.g. `https://myblog.blogspot.com`).
   - Enter your target Telegram channel (`@mychannel` or `-100xxxxxxxx`).
   - Click **👁️ Test Feed** to preview the latest 5 posts parsed from your blog.
   - Adjust the check interval, summary length, and dynamic button text.
   - Under **Fixed Inline Buttons**, add any additional buttons you want on every post.
   - Check **Enable Automatic Background Publishing**.
   - Click **💾 Save Settings**.
   - Click **⚡ Check & Publish Now** to trigger an immediate sync.
