const lookupForm = document.getElementById('lookup-form');
const letterForm = document.getElementById('letter-form');
const clearBtn = document.getElementById('clear-btn');
const continueBtn = document.getElementById('continue-btn');
const lookupStatus = document.getElementById('lookup-status');
const sendStatus = document.getElementById('send-status');
const confirmCard = document.getElementById('confirm-card');
const letterCard = document.getElementById('letter-card');
const resultsEl = document.getElementById('legislator-results');
const letterEl = document.getElementById('letter');
const signaturePreview = document.getElementById('signature-preview');

let matchedLegislators = [];
let matchedLegislatorsByChamber = null;

function getAddress() {
  return {
    street: document.getElementById('street').value.trim(),
    city: document.getElementById('city').value.trim(),
    state: document.getElementById('state').value.trim().toUpperCase(),
    zip: document.getElementById('zip').value.trim(),
    manualHouseDistrict: document.getElementById('manualHouseDistrict').value.trim(),
    manualSenateDistrict: document.getElementById('manualSenateDistrict').value.trim()
  };
}

function getUser() {
  return {
    firstName: document.getElementById('firstName').value.trim(),
    lastName: document.getElementById('lastName').value.trim(),
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim()
  };
}

function setStatus(el, message, type) {
  el.textContent = message || '';
  el.className = `status ${type || ''}`.trim();
}

function displayLegislators(payload) {
  matchedLegislatorsByChamber = payload.legislators;
  matchedLegislators = [payload.legislators.house, payload.legislators.senate];

  const sourceNote = payload.source === 'palegis.us'
    ? '<p class="source-note">Validated using the Pennsylvania General Assembly Find My Legislator site.</p>'
    : `<p class="source-note">Lookup source: ${payload.source}</p>`;

  resultsEl.innerHTML = sourceNote + matchedLegislators.map((l) => `
    <article class="legislator-card">
      <strong>${l.title} ${l.full_name}</strong>
      <p>${l.chamber} District ${l.district_number} • ${l.party}</p>
      <p>${l.email}</p>
    </article>
  `).join('');

  confirmCard.classList.remove('hidden');
  confirmCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildGreeting() {
  if (!matchedLegislatorsByChamber) return 'Dear Legislator,';
  const house = matchedLegislatorsByChamber.house;
  const senate = matchedLegislatorsByChamber.senate;
  return `Dear ${house.title} ${house.last_name} and ${senate.title} ${senate.last_name},`;
}

function buildLetter() {
  return `${buildGreeting()}

As your constituent, I am writing to urge you to prioritize equitable nursing home funding in this year’s Pennsylvania state budget.

Across the Commonwealth, nursing homes are facing a growing crisis. Facilities are closing, beds are disappearing, staffing challenges are worsening, and too many seniors and families are being left with fewer care options close to home. These closures and facility failures are not isolated events. They are warning signs that Pennsylvania’s long-term care system is underfunded and increasingly unstable.

Pennsylvania’s Medicaid reimbursement rates for nursing home care have not kept pace with the actual cost of caring for residents. Pennsylvania continues to lag behind surrounding states in Medicaid reimbursement, making it harder for providers to recruit and retain caregivers, maintain quality, and keep facilities open in communities that depend on them.

This year’s budget must address that problem directly.

I respectfully ask you to support a budget solution that creates fair, predictable, and adequate nursing home funding, including one of the following reforms:

First, eliminate the Budget Adjustment Factor, which artificially suppresses Medicaid payments and prevents reimbursement from reflecting the true cost of care.

Second, if the Budget Adjustment Factor is not eliminated, establish a reasonable Medicaid rate floor so that no nursing home is reimbursed below a sustainable minimum level.

Pennsylvania seniors deserve access to safe, local, high-quality care. Nursing home residents depend on caregivers for 24-hour support, and those caregivers deserve the resources necessary to do their jobs safely and with dignity. When funding falls short, the consequences are felt by residents, families, workers, hospitals, and entire communities.

Equitable nursing home funding is not just a budget issue. It is a senior care issue, a workforce issue, a hospital capacity issue, and a community stability issue.

Please make nursing home funding a priority in this year’s state budget and support reforms that eliminate the Budget Adjustment Factor or establish a meaningful reimbursement floor.

Thank you for your service and for your attention to this urgent issue.`;
}

function updateSignature() {
  const address = getAddress();
  const user = getUser();
  signaturePreview.textContent = `${user.firstName || '[First Name]'} ${user.lastName || '[Last Name]'}\n${address.street || '[Street Address]'}\n${address.city || '[City]'}, ${address.state || 'PA'} ${address.zip || '[ZIP Code]'}\n${user.email || '[Email Address]'}${user.phone ? `\n${user.phone}` : ''}`;
}

lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(lookupStatus, 'Searching for your legislators…', '');
  confirmCard.classList.add('hidden');
  letterCard.classList.add('hidden');

  try {
    const response = await fetch('/api/lookup-legislators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getAddress())
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Lookup failed.');

    setStatus(lookupStatus, 'Legislators found. Please confirm below.', 'success');
    displayLegislators(data);
  } catch (error) {
    setStatus(lookupStatus, error.message, 'error');
  }
});

clearBtn.addEventListener('click', () => {
  lookupForm.reset();
  document.getElementById('state').value = 'PA';
  confirmCard.classList.add('hidden');
  letterCard.classList.add('hidden');
  setStatus(lookupStatus, '', '');
  setStatus(sendStatus, '', '');
});

continueBtn.addEventListener('click', () => {
  letterEl.value = buildLetter();
  updateSignature();
  letterCard.classList.remove('hidden');
  letterCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

['firstName', 'lastName', 'email', 'phone', 'street', 'city', 'state', 'zip'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateSignature);
});

letterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(sendStatus, 'Sending your letter…', '');

  try {
    const payload = {
      ...getUser(),
      ...getAddress(),
      letter: letterEl.value.trim(),
      legislators: matchedLegislators
    };

    const response = await fetch('/api/send-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Letter could not be sent.');

    setStatus(sendStatus, 'Thank you. Your letter has been sent to your Representative, Senator, and governor@pa.gov.', 'success');
  } catch (error) {
    setStatus(sendStatus, error.message, 'error');
  }
});
