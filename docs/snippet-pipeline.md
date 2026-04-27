# Snippet Pipeline

This project now includes a simple media ingestion workflow:

1. Export your current deck JSON from the app.
2. Download a source video and subtitles with `yt-dlp`.
3. Mine subtitle hits for target vocab and cut short audio snippets with `ffmpeg`.
4. Import the updated deck JSON back into the app, or upload it directly into the running API.

## Requirements

- `yt-dlp` installed and on your `PATH`
- `ffmpeg` installed and on your `PATH`

## 1. Download source media

```bash
npm run media:download -- \
  --url "https://www.youtube.com/watch?v=..." \
  --source-id mingbai-ep01
```

This stores source media and subtitle files in `media/sources/<source-id>/`.

`yt-dlp` also works for Bilibili URLs.

The downloader also writes `media/sources/<source-id>/source-manifest.json` so the mining step can auto-detect the downloaded media and subtitle files.

## 2. Mine subtitle hits and cut clips

```bash
npm run clips:mine -- \
  --source-id mingbai-ep01 \
  --deck exports/current-deck.json \
  --source-title "Drama Episode 1"
```

Outputs:

- audio clips in `public/generated-clips/<source-id>/`
- an updated deck JSON in `exports/<source-id>-deck.json`

By default, the script:

- scans existing deck words
- finds subtitle lines that contain each word
- keeps up to 4 matches per word
- stops once a word already has 4 attached clips
- pads each clip by 250ms before and after the subtitle timing
- uses overlapping English subtitles as the translation when available

## 3. Import back into the app

You now have two options:

- Use the app's `Import file` flow with the generated `exports/<source-id>-deck.json`
- Or upload directly into the running local API during mining:

```bash
npm run clips:mine -- \
  --source-id mingbai-ep01 \
  --deck exports/current-deck.json \
  --upload-user demo
```

## Notes

- Short-term: clips are written into `public/generated-clips/` so the local app can serve them directly.
- Long-term: this should move to object storage, with `storageKey` mapped to S3/R2/Supabase Storage and signed URLs.
- The database model is already shaped for that future: card clip usages point at reusable media assets.
