# AR Text Scanner (POC)

Web app that opens the camera on load and uses OCR to detect text. When **2025** is found, it opens [Google](https://www.google.com).

## Run locally

Camera access requires **HTTPS** or **localhost**. Use a simple local server:

```bash
npx serve .
```

Or with Python:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` (or the port shown) and allow camera access.

## Add more rules

Edit `DETECTION_RULES` in `app.js`:

```js
const DETECTION_RULES = [
  { pattern: '2025', url: 'https://www.google.com' },
  { pattern: 'HELLO', url: 'https://example.com' },
];
```

## Notes

- Point the camera at clear, large text for best OCR results.
- If the browser blocks popups, a fallback link appears under the detected text.
- Scan runs about every 1.5 seconds to keep performance reasonable on mobile.
