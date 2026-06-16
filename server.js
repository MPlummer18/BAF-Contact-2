require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const PALEGIS_FIND_URL = 'https://www.palegis.us/find-my-legislator';
const GOVERNOR_EMAIL = process.env.GOVERNOR_EMAIL || 'governor@pa.gov';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const legislators = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'legislators.json'), 'utf8'));

function normalizeDistrictId(chamber, districtNumber) {
  const prefix = chamber.toLowerCase().startsWith('s') ? 's' : 'h';
  return `${prefix}${String(districtNumber).padStart(3, '0')}`;
}

function findLegislator(chamber, districtNumber) {
  const districtId = normalizeDistrictId(chamber, districtNumber);
  return legislators.find((l) => l.district_id === districtId);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDistrictFromText(text, chamber) {
  const patterns = chamber === 'house'
    ? [
        /House\s+District\s*(?:No\.?|#)?\s*(\d{1,3})/i,
        /Representative[^.]{0,180}?District\s*(?:No\.?|#)?\s*(\d{1,3})/i,
        /District\s*(\d{1,3})[^.]{0,180}?House/i
      ]
    : [
        /Senate\s+District\s*(?:No\.?|#)?\s*(\d{1,3})/i,
        /Senator[^.]{0,180}?District\s*(?:No\.?|#)?\s*(\d{1,3})/i,
        /District\s*(\d{1,3})[^.]{0,180}?Senate/i
      ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function parseDistrictsFromPaLegisHtml(html) {
  const text = stripHtml(html);
  const houseDistrict = parseDistrictFromText(text, 'house');
  const senateDistrict = parseDistrictFromText(text, 'senate');

  if (!houseDistrict || !senateDistrict) {
    throw new Error('The PA site responded, but the House and Senate district numbers could not be read from the response. The site markup may have changed, or the address may require a different lookup flow.');
  }

  return { houseDistrict, senateDistrict };
}

async function lookupDistrictsViaPaLegis(address) {
  const url = new URL(PALEGIS_FIND_URL);
  url.searchParams.set('streetAddress', address.street);
  url.searchParams.set('addressCity', address.city);
  url.searchParams.set('state', address.state || 'PA');
  url.searchParams.set('postalCode', address.zip);

  const response = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 PA Constituent Letter Tool'
    }
  });

  if (!response.ok) {
    throw new Error(`The PA legislator lookup site returned status ${response.status}.`);
  }

  const html = await response.text();
  const districts = parseDistrictsFromPaLegisHtml(html);
  return {
    ...districts,
    source: 'palegis.us',
    verificationUrl: url.toString()
  };
}

function extractDistrictsFromGeocodio(result) {
  const fields = result?.results?.[0]?.fields || {};
  const stateLeg = fields.state_legislative_districts || {};

  const house = stateLeg.house || stateLeg.lower || stateLeg.state_house || {};
  const senate = stateLeg.senate || stateLeg.upper || stateLeg.state_senate || {};

  const houseDistrict = Number(house.district_number || house.district || house.name?.match(/\d+/)?.[0]);
  const senateDistrict = Number(senate.district_number || senate.district || senate.name?.match(/\d+/)?.[0]);

  if (!houseDistrict || !senateDistrict) {
    throw new Error('The address was geocoded, but state legislative districts were not returned. Check your address lookup provider configuration.');
  }

  return { houseDistrict, senateDistrict };
}

async function lookupDistrictsViaGeocodio(address) {
  if (!process.env.GEOCODIO_API_KEY) {
    throw new Error('Geocodio lookup is not configured. Add GEOCODIO_API_KEY or set LOOKUP_PROVIDER=palegis.');
  }

  const q = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
  const url = new URL('https://api.geocod.io/v1.7/geocode');
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'stateleg');
  url.searchParams.set('api_key', process.env.GEOCODIO_API_KEY);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Address lookup failed with status ${response.status}.`);
  }

  const result = await response.json();
  const districts = extractDistrictsFromGeocodio(result);
  return { ...districts, source: 'geocodio' };
}

async function lookupDistricts(address) {
  // Manual test mode lets you verify the form and email routing before production launch.
  if (address.manualHouseDistrict && address.manualSenateDistrict) {
    return {
      houseDistrict: Number(address.manualHouseDistrict),
      senateDistrict: Number(address.manualSenateDistrict),
      source: 'manual-test-mode'
    };
  }

  const provider = String(process.env.LOOKUP_PROVIDER || 'palegis').toLowerCase();
  if (provider === 'palegis') return lookupDistrictsViaPaLegis(address);
  if (provider === 'geocodio') return lookupDistrictsViaGeocodio(address);

  throw new Error(`Unsupported LOOKUP_PROVIDER: ${provider}`);
}

app.post('/api/lookup-legislators', async (req, res) => {
  try {
    const { street, city, state = 'PA', zip, manualHouseDistrict, manualSenateDistrict } = req.body || {};

    if (!street || !city || !state || !zip) {
      return res.status(400).json({ error: 'Street address, city, state, and ZIP code are required.' });
    }

    if (state.toUpperCase() !== 'PA') {
      return res.status(400).json({ error: 'This tool only supports Pennsylvania addresses.' });
    }

    const { houseDistrict, senateDistrict, source, verificationUrl } = await lookupDistricts({
      street,
      city,
      state,
      zip,
      manualHouseDistrict,
      manualSenateDistrict
    });

    const house = findLegislator('house', houseDistrict);
    const senate = findLegislator('senate', senateDistrict);

    if (!house || !senate) {
      return res.status(404).json({
        error: 'Districts were found, but one or more legislators were not in the uploaded email list.',
        houseDistrict,
        senateDistrict
      });
    }

    res.json({
      source,
      verificationUrl,
      districts: { house: houseDistrict, senate: senateDistrict },
      legislators: { house, senate }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function validateSubmission(body) {
  const required = ['firstName', 'lastName', 'email', 'street', 'city', 'state', 'zip', 'letter', 'legislators'];
  for (const field of required) {
    if (!body[field]) return `${field} is required.`;
  }
  if (!Array.isArray(body.legislators) || body.legislators.length === 0) return 'At least one legislator recipient is required.';
  return null;
}

function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('Email sending is not configured. Add SMTP settings to .env.');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

app.post('/api/send-letter', async (req, res) => {
  try {
    const error = validateSubmission(req.body || {});
    if (error) return res.status(400).json({ error });

    const {
      firstName,
      lastName,
      email,
      phone,
      street,
      city,
      state,
      zip,
      letter,
      legislators
    } = req.body;

    const transporter = createTransporter();
    const legislatorRecipients = legislators.map((l) => `${l.title} ${l.full_name} <${l.email}>`);
    const to = [...legislatorRecipients, `Governor of Pennsylvania <${GOVERNOR_EMAIL}>`].join(', ');
    const cc = process.env.ORGANIZATION_CC_EMAIL || undefined;

    const body = `${letter}\n\n---\nSubmitted by:\n${firstName} ${lastName}\n${street}\n${city}, ${state} ${zip}\n${email}${phone ? `\n${phone}` : ''}`;

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      replyTo: `${firstName} ${lastName} <${email}>`,
      to,
      cc,
      subject: 'Please Prioritize Equitable Nursing Home Funding in This Year’s State Budget',
      text: body
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`PA legislator letter tool running at http://localhost:${PORT}`);
});
