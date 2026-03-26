# Stock Hub Local

Stock Hub Local is a local-first desktop app for preparing photo metadata once and then opening your upload destinations from one place.

It is built for this workflow:

- import one JPG, multiple JPGs, or a whole folder of JPGs
- generate metadata from the actual image
- edit title, description, keywords, and notes in one screen
- open stock sites in your saved Chrome profile
- export CSV files for marketplaces that support them
- open Facebook and X posting pages from the same app

## Best way to use it

If you just want to use the app, open the portable desktop build:

- `release/StockHubLocal-Portable-0.1.0.exe`

That is the main app now.

## How the app works

1. Import JPG photos into the local library.
2. Choose a draft generation mode in the app settings:
   - `Auto` = use OpenAI if a key is saved, otherwise use the local offline model
   - `Offline` = always use the local model on your PC
   - `OpenAI` = always use the OpenAI API
3. Generate a draft from the selected image.
4. Review and adjust the metadata.
5. Open Adobe Stock, Shutterstock, Facebook, or X directly in your logged-in Chrome profile.
6. Export CSV files for Adobe Stock, Shutterstock, or Vecteezy when needed.

## Metadata generation modes

### Offline mode

- No OpenAI API key is required.
- You do not need to train the model first.
- The app uses pretrained local vision models.
- The first offline run may download model files once, then reuse them locally.

### OpenAI mode

- Requires an OpenAI API key.
- You can save the key inside the app settings panel.
- The saved key is stored locally for this app.

## Why this app uses this flow

Adobe Stock, Shutterstock, and Vecteezy do not provide one simple public upload API that makes a true one-click third-party uploader realistic across all of them.

Because of that, this app focuses on:

- local metadata management
- fast browser shortcuts into your logged-in contributor accounts
- CSV export where marketplaces support it
- human review before final submission

## Main features

- JPG photo import
- drag-and-drop for single files, multiple files, and folders
- local library management
- image-aware metadata generation
- offline metadata generation
- optional OpenAI metadata generation
- per-marketplace export fields
- per-marketplace submission status tracking
- CSV export for:
  - Adobe Stock
  - Shutterstock
  - Vecteezy
- Chrome shortcuts for:
  - Adobe Stock
  - Shutterstock
  - Vecteezy
  - Facebook
  - X

## Data storage

For the portable desktop app, local app data is stored next to the executable inside:

- `StockHubLocalData`

That includes:

- imported images
- saved app settings
- generated metadata
- exported CSV files
- local offline model cache

In a source-code/dev run, local data is stored under:

- `backend/data`

## Development

Install dependencies:

```bash
npm install
```

Development mode:

```bash
npm run dev
```

Desktop mode:

```bash
npm run desktop:start
```

Portable Windows build:

```bash
npm run desktop:package
```

## Notes

- The app is currently photo-focused and expects `.jpg` / `.jpeg` files.
- The advanced marketplace fields are mainly for category codes and CSV/export tracking.
- If Chrome or the saved profile cannot be used, the app can fall back to another browser flow.

## Good next steps

- bulk metadata editing
- reusable keyword presets
- better marketplace-specific validation before export
- EXIF/IPTC write-back into local JPG files
- optional bundled offline models for true first-run offline use
