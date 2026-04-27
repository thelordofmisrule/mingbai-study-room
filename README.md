# Mingbai Study Room

A sentence-first Chinese study app with a React frontend and a small Node/SQLite API.

The app is now built around Glossika-style repetition:

- the SRS unit is the sentence, not the word
- imported texts become sentence banks
- texts belong to practical topics or "language islands"
- study mode focuses on high-volume sentence reps with audio, pinyin, translation, and replay controls

## Local development

```bash
npm install
npm run dev
```

`npm run dev` starts both the Vite client and the API server.

## Production-ish run

```bash
npm run build
npm run start
```

## Deploy on a VPS with Caddy

This app is a good fit for a single VPS because it stores:

- SQLite data in `data/`
- generated Azure audio in `public/generated-tts/azure/`

That means the simplest production setup is:

- one Node process on `127.0.0.1:3010`
- one Caddy site on a subdomain such as `study.example.com`
- HTTP Basic Auth in front of the whole app until real app auth exists

### 1. Install requirements

This app uses `node:sqlite`, so use Node `22.5+` and preferably a recent Node `22.x`.

```bash
node -v
npm -v
```

Then on the VPS:

```bash
git clone <your-repo-url> /srv/mingbai-study-room
cd /srv/mingbai-study-room
npm ci
npm run build
cp .env.example .env.local
```

Fill in `.env.local` with your Azure values if you want TTS online.

### 2. Create a dedicated service user

```bash
sudo useradd --system --user-group --shell /usr/sbin/nologin mingbai || true
sudo chown -R mingbai:mingbai /srv/mingbai-study-room
```

### 3. Install the systemd service

Use the sample file at `deploy/systemd/mingbai-study-room.service`.

```bash
sudo cp deploy/systemd/mingbai-study-room.service /etc/systemd/system/mingbai-study-room.service
sudo systemctl daemon-reload
sudo systemctl enable --now mingbai-study-room
sudo systemctl status mingbai-study-room
```

If you change the project path, user, or port, update the service file first.

### 4. Install and configure Caddy

Use the sample file at `deploy/caddy/Caddyfile.example`.

Generate a password hash:

```bash
caddy hash-password --plaintext 'choose-a-strong-password'
```

Then add a site block like this to `/etc/caddy/Caddyfile`:

```caddy
study.example.com {
	encode zstd gzip

	basic_auth {
		studyuser YOUR_BCRYPT_HASH
	}

	reverse_proxy 127.0.0.1:3010
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
sudo systemctl status caddy
```

### 5. Back up the important directories

At minimum, back up:

- `data/`
- `public/generated-tts/azure/`
- `.env.local`

### 6. Update the app later

```bash
cd /srv/mingbai-study-room
git pull
npm ci
npm run build
sudo systemctl restart mingbai-study-room
```

## Current product shape

The app currently has three main views:

- `Study`: Glossika-like sentence review with autoplay or manual playback
- `Topics`: topic islands such as travel, barber, restaurants, or custom themes
- `Texts`: imported reading/listening texts that are broken into reusable sentence units

In study mode, you can:

- review daily sentence reps
- autoplay sentence audio or pause and replay manually
- switch playback speed
- reveal pinyin and translation alongside the sentence
- rate each sentence with `Repeat`, `Good`, or `Easy`

In text mode, you can:

- import or paste a Chinese text
- assign it to a topic
- edit sentence pinyin, translation, and notes
- generate Azure sentence audio and cache it locally
- play all sentence audio in sequence
- import sentence banks from CSV or TSV files

## Sentence bank CSV / TSV format

Recommended headers:

```text
sentence,pinyin,translation,tags,topic,note
```

Example:

```text
sentence,pinyin,translation,tags,topic,note
你好。,nǐ hǎo,Hello,"greeting,basics",greetings,Simple opener
我要一碗面。,wǒ yào yì wǎn miàn,I'd like a bowl of noodles.,"ordering,food",restaurant,Common ordering sentence
```

Notes:

- `sentence` is the only required column
- `tags` should be a comma-separated list inside the cell
- `topic` maps the sentence into a language island
- `note` is optional and stays attached to the sentence
- headers can be in any order
- supported header aliases include `text` for `sentence` and `english` for `translation`

## Persistence

Study data lives in SQLite instead of `localStorage`.

- database file: `data/mingbai-study-room.sqlite`
- default dev user: `demo`

The current schema uses:

- `reading_texts`: text-level metadata such as title, topic, notes, cover image, and source content
- `reading_sentences`: sentence units, pinyin, translation, notes, SRS state, and attached audio
- `media_assets`: reusable audio/video metadata
- `user_preferences`: theme, pinyin mode, audio mode, speeds, and other study settings

## Azure TTS

This app can generate sentence audio with Azure Speech, save the returned audio locally, and reuse it on later playbacks.

Setup:

1. Create an Azure AI Speech resource in Azure.
2. Copy the resource key and region.
3. Put them in `.env.local`:

```bash
cp .env.example .env.local
```

```bash
AZURE_SPEECH_KEY=your-azure-speech-key
AZURE_SPEECH_REGION=your-azure-speech-region
AZURE_SPEECH_VOICE=zh-CN-XiaoxiaoNeural
```

4. Restart the app.

Generated audio is cached locally under `public/generated-tts/azure`, so playback after the first synthesis call does not hit Azure again.

## Local dictionary lookup

The app can autofill pinyin and glosses from a local CC-CEDICT install.

To install it:

1. Manually download the CC-CEDICT `.txt.gz` file.
2. Install it into the app:

```bash
npm run dict:install -- --file "/path/to/cedict_1_0_ts_utf-8_mdbg.txt.gz"
```

3. Restart the app server.

The lookup stays local after that. No runtime scraping or live website access is used.

## Notes

SQLite is a good fit for local development or a small single-instance deployment. If this grows into a larger multi-user product, the natural next step is:

- Postgres for relational data
- object storage for audio assets
- authentication on the API
- signed media URLs for private media

Some older vocab-import and clip-mining scripts still exist in the repo, but the main app experience is now sentence-first.
