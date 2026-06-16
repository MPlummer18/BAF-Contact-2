# PA Legislator Nursing Home Funding Letter Tool

This starter website lets a Pennsylvania resident enter an address, match to their state House and Senate legislators, review one dynamic form letter addressed to both officials, and send that same letter securely to both offices and governor@pa.gov through a backend email route.

## What's included

- PA-style address lookup form: Address, City/Town, State, ZIP Code, Search, Clear
- Legislator database generated from `Legislative District Email List.xlsx`
- Automatic governor recipient: `governor@pa.gov`
- Dynamic combined greeting: `Dear Representative [Last Name] and Senator [Last Name],`
- Auto-filled signature block from the user's form entries
- Secure server-side email sending through SMTP/Nodemailer
- Default server-side lookup through the Pennsylvania General Assembly Find My Legislator site
- Developer test mode to manually enter House and Senate district numbers during QA

## Files

- `public/index.html` — page markup
- `public/styles.css` — styling
- `public/app.js` — browser logic
- `server.js` — Express backend, legislator lookup, email sending
- `data/legislators.json` — uploaded legislator email list converted to JSON
- `.env.example` — environment variable template
- `package.json` — Node app configuration

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Then open:

```text
http://localhost:3000
```

## Address matching

The included backend now defaults to the Pennsylvania General Assembly lookup flow. Set this in `.env`:

```text
LOOKUP_PROVIDER=palegis
```

When a user submits an address, the backend creates a server-side request to:

```text
https://www.palegis.us/find-my-legislator
```

with the address fields, then parses the returned page for PA House and Senate district numbers. The user stays on your site. Your site then matches those district numbers to `data/legislators.json` and generates the form email.

Important production note: this relies on the public PA website response staying parseable. If the PA site changes its markup or blocks automated requests, the parser in `server.js` may need to be updated. For maximum reliability, keep the Geocodio adapter or a GIS district dataset as a fallback.

Developer test mode remains available: open the test panel in the lookup form and manually enter a House district and Senate district. This verifies that routing and letter generation work even before live lookup is QA-tested.

## Email sending

Add SMTP settings in `.env`:

```text
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Organization Name <no-reply@example.org>"
ORGANIZATION_CC_EMAIL=
GOVERNOR_EMAIL=governor@pa.gov
```

A single combined letter is sent to the matched House legislator, matched Senate legislator, and `governor@pa.gov` in the `To:` field, with the constituent set as the reply-to address. You can override the governor recipient with `GOVERNOR_EMAIL=` in `.env` if needed.

## Production recommendations

Before launch, add:

- CAPTCHA or Cloudflare Turnstile
- Rate limiting
- Consent checkbox
- Privacy notice
- Submission logging, if desired
- Email deliverability setup: SPF, DKIM, DMARC
- QA checks across addresses in split municipalities and split ZIP codes

## Form letter subject

`Please Prioritize Equitable Nursing Home Funding in This Year’s State Budget`
