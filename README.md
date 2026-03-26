# Stock Hub Local

Local-first stock contributor workspace for a single user.

This MVP is built around the workflow you chose:

- import JPG photos into one local library
- create and edit metadata once
- track submission status per marketplace
- keep contributor sessions stored locally on your PC
- export CSV files for Adobe Stock, Shutterstock, and Vecteezy
- open each marketplace dashboard or upload page from the same app
- open Facebook and X posting pages in the same saved Chrome profile
- choose automatic, OpenAI, or offline metadata generation from inside the app

## Why this shape

Adobe Stock, Shutterstock, and Vecteezy do not currently offer a clean public contributor upload API that makes a true one-click third-party uploader realistic across all three. Because of that, this project uses a safer and more durable flow:

- local metadata management
- marketplace-specific CSV export
- persistent browser sessions for manual upload/review

## Run it

Optional for OpenAI-powered image metadata:

```bash
set OPENAI_API_KEY=your_key_here
```

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

Desktop mode:

```bash
npm run desktop:start
```

Portable Windows `.exe` build:

```bash
npm run desktop:package
```

The packaged portable app is written to `release/StockHubLocal-Portable-0.1.0.exe`.

## Data location

All local app data is stored under:

- `backend/data/library` for imported files
- `backend/data/profiles` for marketplace browser sessions
- `backend/data/state.json` for metadata and statuses
- `backend/data/exports` for generated CSV files

For the Electron desktop build, app data is stored under the app user-data directory, and for the portable Windows build it is stored next to the executable inside `StockHubLocalData`.

## Current scope

- photos only
- JPG import
- image-aware draft metadata when `OPENAI_API_KEY` is configured
- offline local draft metadata with a pretrained vision model
- filename fallback draft if the offline model is not available yet
- per-marketplace category fields
- per-marketplace status tracking
- quick posting shortcuts for Facebook and X
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

## Notes about offline mode

- You do not need to train the offline model before using it.
- The offline mode uses pretrained local models and stores them under the app data folder.
- The first offline generation run may download a few hundred megabytes of model files once, then it can keep working locally afterward.
