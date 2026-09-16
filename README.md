# ResitKira — offline-first LHDN relief ledger

A installable PWA (progressive web app) for Android that photographs receipts,
sorts them against LHDN (Malaysia) personal tax relief categories, and stores
everything locally on the device — with an optional online boost from Gemini
when you have connectivity.

## How it decides where a receipt goes

- **Online + Gemini key set**: the photo is sent straight to the Gemini API
  (from your phone, using your own key — no server in between) with the
  current relief category list as context. Gemini reads the merchant, date,
  amount and line items, and proposes every category the receipt could
  qualify for.
- **Offline, or no Gemini key set**: Tesseract.js (bundled, runs entirely
  on-device) extracts text from the photo, and a keyword list matches it
  against the relief categories. This is cruder — it's flagged
  "unconfirmed" in the ledger and you fill in merchant/amount yourself.
- Either way, you get a confirmation screen before anything is saved, with
  every matched category as a tickbox — leave several ticked and the receipt
  is filed once per category (same image, separate ledger rows).

## Getting it onto your phone

1. Host these files somewhere reachable over HTTPS (GitHub Pages, Netlify,
   Vercel, Cloudflare Pages all have free tiers — PWAs need HTTPS to install
   and to run a service worker).
2. Open the URL in Chrome on Android.
3. Chrome will offer "Add to Home screen" / "Install app" — do that. From
   then on it opens like a native app and, because the service worker
   caches the app shell and the OCR library on first load, it keeps working
   with no signal at all.

## Setting up Gemini (optional)

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com).
2. In the app's Settings tab, paste it into "Gemini API key".
3. Leave the model id as `gemini-2.5-flash` unless it stops working — Google
   renames/retires model ids every so often; if you start getting request
   failures, check Google AI Studio for the current name and update the
   field.
4. Your key is stored only in this device's local IndexedDB. It is never
   sent anywhere except directly to Google's API. Don't hand this build of
   the app (with your key already typed in) to anyone else.

## Backing up before you clear cookies/site data

Your receipts and images live only in this browser's local storage
(IndexedDB) — nothing is on a server. That means clearing cookies/site data,
switching phones, reinstalling Chrome, or uninstalling the app will erase
your ledger with no way to recover it. Before doing any of that:

1. Settings → **"Back up everything (ZIP)"** — downloads every receipt
   across all years into a zip, sorted into category folders, with a
   `manifest.json` the app uses to restore precisely.
2. After clearing data (or on a new phone), open the app again, go to
   Settings → **"Restore from ZIP backup"**, and pick that zip file.
3. Records already in your ledger are skipped on restore, so restoring the
   same backup twice is safe and won't duplicate anything.

Only zips produced by this app's own backup button can be restored
automatically (they need the manifest.json inside) — a hand-built zip, or
one from a version of the app before backup/restore existed, will be
rejected.

## Donation vs. tax relief — why they're separate tabs

LHDN treats these two things differently, so the app tracks them separately:

- **Tax relief** (Ledger tab) reduces your *chargeable income* after your
  total income is already worked out, each category capped individually
  (e.g. lifestyle at RM2,500).
- **Donations** (Donation tab) to approved institutions are a *deduction*
  from your *aggregate income*, capped at 10% of that income — a different
  stage of the calculation entirely, and a different cap rule (percentage
  of income, not a fixed ringgit ceiling).

Donations only qualify if the recipient is approved by LHDN under
Subsection 44(6) of the Income Tax Act. The app can't verify this
automatically (there's no reliable way to check the live approval list from
the device), so it always flags donation entries as "unverified" until you
manually check the organization at
[LHDN's approval checker](https://www.hasil.gov.my/institusi-organisasi-tabung/semakan-kelulusan-derma/)
and tick "I've checked this org" yourself. Donations to the government,
a state government, or a local authority are uncapped — tick "Government /
state / local authority" for those.

## Tax calculation tab

Semi-automatic estimate of your final tax payable for a given assessment
year:

- **Pulled automatically**: your relief total from the Ledger (each
  category capped individually) and your donation total from the Donation
  tab (capped at 10% of the salary you enter).
- **Entered manually**: annual salary (from your EA Form), zakat paid, and
  any reliefs the Ledger doesn't track (spouse, child, SOCSO, etc. — enter
  those as one combined figure).
- The calculation follows LHDN's actual sequence: aggregate income → less
  donation deduction → total income → less all reliefs → chargeable income →
  progressive tax brackets → less rebates (RM400 individual rebate below
  RM35,000 chargeable income, plus zakat as a ringgit-for-ringgit rebate on
  the final tax bill — not a deduction from income, even though it's
  entered in the same section for convenience).
- The Tax Calc tab links directly to LHDN's live tax-rate and tax-relief
  pages ("Check current tax brackets on LHDN ↗" and "Check current tax
  relief list on LHDN ↗") rather than hardcoding a "last verified" date —
  rates and relief amounts can change with each Budget, so these are meant
  to be tapped whenever you're unsure the app's numbers are still current.
- The reference list of common "other reliefs" (spouse, child, SOCSO, etc.)
  flags which items overlap with receipt categories already tracked in the
  Ledger (childcare, EPF/life insurance, parents' medical, EV charging) —
  don't enter those in "Other reliefs" too, or they'll be double-counted.
- This is an estimate: it doesn't cover business income, spouse joint
  assessment, dividend tax, or every special case. Always verify in MyTax
  before filing.

## Keeping the relief list current

The app ships with a YA2025 relief category list baked in
(`lhdn-data.js`). Since LHDN's caps and categories change most years:

1. Host a JSON file shaped like:
   ```json
   { "categories": [ { "id": "...", "label": "...", "cap": 2500, "capNote": "...", "keywords": ["..."] } ] }
   ```
2. Paste that file's URL into Settings → "Refresh URL" and tap "Refresh
   now". The app caches whatever it fetches and keeps using it (even
   offline) until you refresh again.
3. If you never set a refresh URL, the app just uses the bundled list
   forever — still functional, just not automatically current.

## Limitations worth knowing

- This isn't tax advice, and category matches (from either Gemini or the
  offline fallback) are suggestions — always sanity-check against the
  actual LHDN relief schedule before filing, especially for anything near a
  cap.
- Offline OCR accuracy depends heavily on photo quality/lighting; expect to
  correct amounts and merchant names by hand fairly often.
- Multi-category duplication is per full receipt right now — if you need
  to split a single receipt's *items* across categories (e.g. RM50 of it is
  books, RM30 is sports gear), you'll need to enter those as two manual
  amounts rather than the app parsing individual line totals.
  
