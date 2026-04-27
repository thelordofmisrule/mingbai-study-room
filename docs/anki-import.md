# Anki Import

This project can extract a compatible Anki `.apkg` vocabulary deck and seed the useful word data into Mingbai.

The current importer is aimed at decks that have fields like:

- `Word`
- `Meanings`
- `Pinyin`
- `Example Sentences`

For the provided `5000 Most Frequent Chinese Words With Wiktionary Entries` deck, the importer will:

- create Mingbai cards from the frequency list
- keep the first usable example sentence as the main card example
- attach up to 3 extra dictionary examples as text-only usage examples
- keep frequency metadata in the card notes and tags
- merge the import into your existing local SQLite user without needing the app to be running

## Requirements

- `sqlite3` installed and on your `PATH`
- `unzip` installed and on your `PATH`

## Seed The Local Database

This is the main path if you just want to populate Mingbai with words.

```bash
npm run anki:seed -- \
  --apkg "/Users/a86136/Downloads/5000_Most_Frequent_Chinese_Words_With_Wiktionary_Entries.apkg" \
  --db-user demo \
  --limit 1000
```

The command reads the useful fields from the Anki package, merges on `hanzi`, and writes the result directly into `data/mingbai-study-room.sqlite`.

## Import To A JSON File

```bash
npm run anki:import -- \
  --apkg "/Users/a86136/Downloads/5000_Most_Frequent_Chinese_Words_With_Wiktionary_Entries.apkg" \
  --output exports/chinese-frequency.json
```

## Merge Into The Running Local User

Start the app first:

```bash
npm run dev
```

Then run:

```bash
npm run anki:import -- \
  --apkg "/Users/a86136/Downloads/5000_Most_Frequent_Chinese_Words_With_Wiktionary_Entries.apkg" \
  --upload-user demo
```

## Limit The Import

If you want a smaller starting deck:

```bash
npm run anki:import -- \
  --apkg "/Users/a86136/Downloads/5000_Most_Frequent_Chinese_Words_With_Wiktionary_Entries.apkg" \
  --limit 1000 \
  --upload-user demo
```

## Notes

- The importer merges on `hanzi`, so existing manually-edited cards are preserved and enriched rather than overwritten.
- `npm run anki:seed` is the simplest way to populate the database directly.
- If older imports already show the raw Anki deck filename on cards, clean that metadata with `npm run anki:cleanup -- --user demo`.
- The source Anki deck contains word audio, but this importer currently only counts it; it does not yet extract or attach that audio inside Mingbai.
- If you are not uploading directly, the generated JSON can be brought into the app with `Import file`.
