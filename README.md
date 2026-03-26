# Stock Hub Local

Local-first stock contributor workspace for a single user.

This MVP is built around the workflow you chose:

- import JPG photos into one local library
- create and edit metadata once
- track submission status per marketplace
- keep contributor sessions stored locally on your PC
- export CSV files for Adobe Stock, Shutterstock, and Vecteezy
- open each marketplace dashboard or upload page from the same app

## Why this shape

Adobe Stock, Shutterstock, and Vecteezy do not currently offer a clean public contributor upload API that makes a true one-click third-party uploader realistic across all three. Because of that, this project uses a safer and more durable flow:

- local metadata management
- marketplace-specific CSV export
- persistent browser sessions for manual upload/review

## Run it

Install dependencies:

```bash
npm install
npx playwright install chromium
```

Development mode:

```bash
npm run dev
```

Local hosted build:

```bash
npm run build
npm start
```

Then open [http://localhost:4242](http://localhost:4242).

## Data location

All local app data is stored under:

- `backend/data/library` for imported files
- `backend/data/profiles` for marketplace browser sessions
- `backend/data/state.json` for metadata and statuses
- `backend/data/exports` for generated CSV files

## Current scope

- photos only
- JPG import
- draft metadata generation from filenames
- per-marketplace category fields
- per-marketplace status tracking
- CSV export for:
  - Adobe Stock
  - Shutterstock
  - Vecteezy

## Good next steps

- add bulk metadata editing
- add keyword presets and reusable templates
- add EXIF/IPTC write-back into local JPG files
- add direct SFTP helpers for marketplaces that support it
- add marketplace-specific validation rules before export
