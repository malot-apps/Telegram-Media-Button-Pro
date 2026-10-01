# Telegram Media Button Pro v2.1

Adds direct browser upload while keeping the original Telegram bot workflow.

## New web workflow

1. Open the web panel.
2. Enter `ADMIN_SECRET`.
3. Choose Video or Photo.
4. Select a local media file.
5. Add up to 12 URL buttons.
6. Click **Publish Now**.
7. The Render server uploads the media to Telegram and publishes it to `CHANNEL_ID`.

The old `Telegram file_id` web publishing method still works.

## Deployment

Set these environment variables in Render:

- `BOT_TOKEN`
- `CHANNEL_ID`
- `ADMIN_IDS`
- `ADMIN_SECRET`
- `PORT` (Render normally supplies this; default 3000)

Then run:

```bash
npm install
npm start
```

## Important

- The browser upload endpoint accepts video/image files up to 50 MB.
- Scheduled publishing still uses an existing Telegram `file_id`.
- Keep `.env` out of GitHub. Use Render Environment Variables.
- Make `ADMIN_SECRET` long and random.
