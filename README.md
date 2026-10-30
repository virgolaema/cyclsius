# Cyclsius

Cycle and basal body temperature (BBT) tracker using the symptothermal method.
Runs fully offline; data stays on the device.

## Features

- Daily entry: temperature (°C/°F), time, disturbed-value flag, bleeding, cervical mucus, intercourse, note
- Temperature shift detection: 3-over-6 rule with Sensiplan exceptions 1 and 2 (readings rounded to 0.05 °C)
- Coverline, first high temperature, estimated ovulation (day before first high)
- Mucus peak day (+3 days); post-ovulatory infertility needs both temperature and mucus when mucus is recorded
- Pre-ovulatory infertile days: 5-day rule, minus-8 rule from past cycles, first mucus day
- Predictions: next period, ovulation, fertile window, late period, possible pregnancy (≥18 high days), short luteal phase warning
- Chart per cycle, month calendar, statistics (cycle/period/luteal lengths, ovulation day)
- JSON/CSV export and import, demo data

Not a medical device; do not use as contraception without training in the method.

## Install on a phone

- **Android APK**: download `cyclsius.apk` from the latest GitHub Release and open it
  (allow "install unknown apps" for your browser/file manager). New releases install as updates and keep your data.
- **Web app (Android or iPhone)**: open the GitHub Pages URL in Chrome/Safari and use
  "Add to Home screen" / "Install app". Works offline after the first load.

## Development

```bash
npm ci
npm test            # calculation unit tests
npm run test:e2e    # browser tests (Playwright, phone viewport)
npm run serve       # http://127.0.0.1:8080/
```

The web app is plain HTML/JS in `www/` (logic in `www/cycle.js`, UI in `www/app.js`).
The Android app is a Capacitor wrapper (`android/`); CI builds and publishes the APK on every push to `main`.
`scripts/make-icons.js` and `scripts/android-assets.js` regenerate icons from `scripts/icon.svg`.

The APK is signed with `android/app/cyclsius.keystore` (committed, password `cyclsius`) so builds update in place.
To sign with a private key instead, set the `SIGNING_*` environment variables read in `android/app/build.gradle`.
