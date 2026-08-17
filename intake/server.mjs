import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(here, 'public');

const port = Number(process.env.PORT ?? process.env.NODE_PORT ?? 4000);

// Twenty API access. TWENTY_API_URL points at the CRM service; on Railway use
// the private network address so intake traffic never leaves the project.
const apiUrl = (process.env.TWENTY_API_URL ?? '').replace(/\/+$/, '');
const apiKey = process.env.TWENTY_API_KEY ?? '';

// Object + field names in the Twenty data model. Overridable so a workspace
// that named things differently does not require a code change.
const teamObject = process.env.TWENTY_TEAM_OBJECT ?? 'teams';
const teamNameField = process.env.TWENTY_TEAM_NAME_FIELD ?? 'name';
// A prospect is stored as a Person (contact details) plus an Opportunity
// linked to the chosen Team, matching the teams <-> opportunities relation
// already present in the workspace.
const personObject = process.env.TWENTY_PERSON_OBJECT ?? 'people';
// Field metadata id of attachments.file, needed by the upload mutation.
const attachmentFileFieldId =
  process.env.TWENTY_ATTACHMENT_FILE_FIELD_ID ??
  '44243f77-42e7-4bb6-83ba-676ba1764d36';
const opportunityObject = process.env.TWENTY_OPPORTUNITY_OBJECT ?? 'opportunities';
const pickupOrderObject = process.env.TWENTY_PICKUP_ORDER_OBJECT ?? 'pickupOrders';

const missingConfig = [];
if (!apiUrl) missingConfig.push('TWENTY_API_URL');
if (!apiKey) missingConfig.push('TWENTY_API_KEY');

if (missingConfig.length > 0) {
  console.warn(
    `[intake] Missing ${missingConfig.join(', ')}. ` +
      'The forms will load but cannot read teams or save records until these are set.',
  );
}

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const sendJson = (response, status, body) => {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
};

const readJsonBody = (request) =>
  new Promise((resolve, reject) => {
    let raw = '';
    let aborted = false;

    request.on('data', (chunk) => {
      if (aborted) return;
      raw += chunk;
      // Intake payloads are small; refuse anything that is not. Stop reading
      // but let the caller answer with a real status instead of a reset socket.
      if (raw.length > 64_000) {
        aborted = true;
        request.pause();
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
      }
    });

    request.on('end', () => {
      if (aborted) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    request.on('error', reject);
  });

const twentyRequest = async (endpoint, init = {}) => {
  if (missingConfig.length > 0) {
    throw Object.assign(new Error('Twenty API is not configured'), {
      statusCode: 503,
    });
  }

  const response = await fetch(`${apiUrl}/rest/${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    // Log the CRM's own message for operators, but never return it to the
    // browser: it can echo workspace internals.
    console.error(
      `[intake] Twenty ${init.method ?? 'GET'} /rest/${endpoint} -> ${response.status}`,
      text.slice(0, 500),
    );
    throw Object.assign(new Error(`Twenty responded ${response.status}`), {
      statusCode: response.status === 404 ? 502 : 502,
    });
  }

  return payload;
};

// Twenty's REST list responses nest records under data.<objectName>.
const extractRecords = (payload, objectName) => {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[objectName])) return data[objectName];

  for (const value of Object.values(data ?? {})) {
    if (Array.isArray(value)) return value;
  }

  return [];
};

// Twenty text fields are sometimes plain strings and sometimes composite
// objects; read whichever shape the workspace actually returns.
const readTextField = (record, field) => {
  const value = record?.[field];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return value.firstName && value.lastName
      ? `${value.firstName} ${value.lastName}`.trim()
      : (value.label ?? value.name ?? value.text ?? '');
  }
  return '';
};

const getTeams = async () => {
  const payload = await twentyRequest(
    `${encodeURIComponent(teamObject)}?limit=200&order_by=${encodeURIComponent(teamNameField)}`,
  );

  return extractRecords(payload, teamObject)
    .map((record) => ({
      id: record.id,
      name: readTextField(record, teamNameField),
    }))
    .filter((team) => team.id && team.name)
    .sort((a, b) => a.name.localeCompare(b.name));
};

const NIGERIA_DIAL = '+234';

// Nigerian mobile numbers are 10 national digits after the leading 0
// (e.g. 0801 234 5678 -> 8012345678).
const normalizeNigerianMobile = (input) => {
  const digits = String(input ?? '').replace(/\D/g, '');
  let national = digits;

  if (national.startsWith('234')) national = national.slice(3);
  national = national.replace(/^0+/, '');

  if (national.length !== 10) return null;
  if (!/^[789]/.test(national)) return null;

  return `${NIGERIA_DIAL}${national}`;
};

const isEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value ?? '').trim());

const clean = (value, max = 300) => String(value ?? '').trim().slice(0, max);

const splitName = (fullName) => {
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
};

const createProspect = async (body) => {
  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const teamId = clean(body.teamId, 64);
  const whatsapp = normalizeNigerianMobile(body.whatsapp);

  const errors = {};
  if (name.length < 2) errors.name = 'Enter the prospect’s full name.';
  if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  if (!teamId) errors.team = 'Choose a team.';
  if (!whatsapp) {
    errors.phone = 'Enter a valid Nigerian WhatsApp number.';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, status: 400, errors };
  }

  const { firstName, lastName } = splitName(name);

  // 1. The person holds the contact details.
  const personResponse = await twentyRequest(encodeURIComponent(personObject), {
    method: 'POST',
    body: JSON.stringify({
      name: { firstName, lastName },
      emails: { primaryEmail: email },
      phones: {
        primaryPhoneNumber: whatsapp.slice(NIGERIA_DIAL.length),
        primaryPhoneCallingCode: NIGERIA_DIAL,
        primaryPhoneCountryCode: 'NG',
      },
      // Registering later upgrades this same person to Registered.
      memberStatus: 'PROSPECT',
    }),
  });

  const personId =
    personResponse?.data?.createPerson?.id ??
    personResponse?.data?.id ??
    personResponse?.id;

  // 2. The opportunity carries the prospect through the team's pipeline.
  //    If this fails the person is already saved, so surface the failure
  //    rather than reporting a clean success.
  await twentyRequest(encodeURIComponent(opportunityObject), {
    method: 'POST',
    body: JSON.stringify({
      name,
      stage: 'NEW',
      teamId,
      ...(personId ? { pointOfContactId: personId } : {}),
    }),
  });

  return { ok: true, status: 201, name };
};

// --- Member registration ---------------------------------------------------

const TITLES = new Set(['MR', 'MRS', 'MISS']);
const GENDERS = new Set(['MALE', 'FEMALE']);
const YES_NO = new Set(['YES', 'NO']);
const TERMS_COUNT = 7;

// A prospect becomes a member, so an existing person is upgraded rather than
// duplicated. Match on email first, then on the WhatsApp number.
const findExistingPerson = async (email, nationalNumber) => {
  // Twenty supports eq/ilike here but not ieq; ilike gives the
  // case-insensitive match an email address needs.
  const lookups = [
    `filter=emails.primaryEmail[ilike]:${encodeURIComponent(email)}`,
    `filter=phones.primaryPhoneNumber[eq]:${encodeURIComponent(nationalNumber)}`,
  ];

  for (const filter of lookups) {
    try {
      const payload = await twentyRequest(
        `${encodeURIComponent(personObject)}?limit=1&${filter}`,
      );
      const [match] = extractRecords(payload, personObject);
      if (match?.id) return match.id;
    } catch {
      // A failed lookup should not block registration; fall through to create.
    }
  }

  return null;
};

const uploadAttachment = async (dataUrl, filename, personId) => {
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl ?? '');
  if (!match) return;

  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) return;

  const form = new FormData();
  form.append(
    'operations',
    JSON.stringify({
      query:
        'mutation U($file: Upload!, $fieldMetadataId: String!) { uploadFilesFieldFile(file: $file, fieldMetadataId: $fieldMetadataId) { id path } }',
      variables: { file: null, fieldMetadataId: attachmentFileFieldId },
    }),
  );
  form.append('map', JSON.stringify({ 0: ['variables.file'] }));
  form.append('0', new Blob([buffer], { type: mimeType }), filename);

  const uploadResponse = await fetch(`${apiUrl}/metadata`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const uploaded = await uploadResponse.json().catch(() => ({}));
  const filePath = uploaded?.data?.uploadFilesFieldFile?.path;
  if (!filePath) {
    console.error('[intake] file upload failed', JSON.stringify(uploaded).slice(0, 300));
    return;
  }

  await twentyRequest('attachments', {
    method: 'POST',
    body: JSON.stringify({
      name: filename,
      fullPath: filePath,
      targetPersonId: personId,
    }),
  });
};

const registerMember = async (body) => {
  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 80);
  const email = clean(body.email, 200).toLowerCase();
  const whatsapp = normalizeNigerianMobile(body.whatsapp);
  const title = clean(body.title, 10).toUpperCase();
  const gender = clean(body.gender, 10).toUpperCase();
  const dateOfBirth = clean(body.dateOfBirth, 20);
  const training = clean(body.trainingCommitment, 5).toUpperCase();

  const errors = {};
  if (firstName.length < 2) errors.firstName = 'Enter your first name.';
  if (lastName.length < 2) errors.lastName = 'Enter your last name.';
  if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  if (!whatsapp) errors.phone = 'Enter a valid Nigerian WhatsApp number.';
  if (!TITLES.has(title)) errors.title = 'Choose a title.';
  if (!GENDERS.has(gender)) errors.gender = 'Choose a gender.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) errors.dateOfBirth = 'Enter your date of birth.';
  if (!YES_NO.has(training)) errors.trainingCommitment = 'Answer the training question.';
  if (!clean(body.addressStreet, 200)) errors.addressStreet = 'Enter your street address.';
  if (!clean(body.addressCity, 100)) errors.addressCity = 'Enter your city.';
  if (!clean(body.addressState, 100)) errors.addressState = 'Enter your state.';
  if (!clean(body.addressCountry, 100)) errors.addressCountry = 'Enter your country.';
  if (!clean(body.occupation, 2000)) errors.occupation = 'Tell us what you do for work.';
  if (!clean(body.sponsor, 120)) errors.sponsor = 'Enter your sponsor.';
  if (!clean(body.upline, 120)) errors.upline = 'Enter your upline.';

  const accepted = Array.isArray(body.termsAccepted) ? body.termsAccepted : [];
  if (accepted.filter(Boolean).length !== TERMS_COUNT) {
    errors.terms = 'You must accept every term to continue.';
  }

  if (!/^data:image\/[\w+.-]+;base64,/.test(body.signature ?? '')) {
    errors.signature = 'Please sign to confirm your commitment.';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, status: 400, errors };
  }

  const now = new Date().toISOString();
  const record = {
    name: { firstName, lastName },
    emails: { primaryEmail: email },
    phones: {
      primaryPhoneNumber: whatsapp.slice(NIGERIA_DIAL.length),
      primaryPhoneCallingCode: NIGERIA_DIAL,
      primaryPhoneCountryCode: 'NG',
    },
    title,
    gender,
    dateOfBirth,
    residentialAddress: {
      addressStreet1: clean(body.addressStreet, 200),
      addressCity: clean(body.addressCity, 100),
      addressState: clean(body.addressState, 100),
      addressCountry: clean(body.addressCountry, 100),
    },
    occupation: clean(body.occupation, 2000),
    priorExperience: clean(body.priorExperience, 2000),
    sponsor: clean(body.sponsor, 120),
    upline: clean(body.upline, 120),
    trainingCommitment: training,
    memberStatus: 'REGISTERED',
    termsAcceptedAt: now,
    registeredAt: now,
  };

  const existingId = await findExistingPerson(
    email,
    whatsapp.slice(NIGERIA_DIAL.length),
  );

  let personId = existingId;

  if (existingId) {
    await twentyRequest(`${encodeURIComponent(personObject)}/${existingId}`, {
      method: 'PATCH',
      body: JSON.stringify(record),
    });
  } else {
    const created = await twentyRequest(encodeURIComponent(personObject), {
      method: 'POST',
      body: JSON.stringify(record),
    });
    personId =
      created?.data?.createPerson?.id ?? created?.data?.id ?? created?.id;
  }

  // Files are best-effort: a storage failure must not discard a completed
  // registration, so failures are logged rather than thrown.
  if (personId) {
    try {
      await uploadAttachment(body.signature, `signature-${lastName}.png`, personId);
      if (body.photo) {
        await uploadAttachment(body.photo, `photo-${lastName}.jpg`, personId);
      }
    } catch (error) {
      console.error('[intake] attachment step failed:', error.message);
    }
  }

  return { ok: true, status: 201, upgraded: Boolean(existingId), firstName };
};

const submitPickupOrder = async (body) => {
  const name = clean(body.name, 120);
  const orderId = clean(body.orderId, 64);
  const neolifeId = clean(body.neolifeId, 64);
  const whatsapp = normalizeNigerianMobile(body.whatsapp);

  const errors = {};
  if (name.length < 2) errors.name = 'Enter your full name.';
  if (!orderId) errors.orderId = 'Enter your order ID.';
  if (!neolifeId) errors.neolifeId = 'Enter your NeoLife ID.';
  if (!whatsapp) errors.phone = 'Enter a valid Nigerian WhatsApp number.';

  if (Object.keys(errors).length > 0) {
    return { ok: false, status: 400, errors };
  }

  const national = whatsapp.slice(NIGERIA_DIAL.length);

  // Link the order to the member's existing record when the number matches.
  // An unmatched order still saves: the details typed are the point, and an
  // unlinked order is far better than a lost one.
  let memberId = null;
  try {
    const payload = await twentyRequest(
      `${encodeURIComponent(personObject)}?limit=1&filter=phones.primaryPhoneNumber[eq]:${encodeURIComponent(national)}`,
    );
    const [match] = extractRecords(payload, personObject);
    memberId = match?.id ?? null;
  } catch {
    // fall through unlinked
  }

  await twentyRequest(encodeURIComponent(pickupOrderObject), {
    method: 'POST',
    body: JSON.stringify({
      name,
      orderId,
      neolifeId,
      whatsappNumber: {
        primaryPhoneNumber: national,
        primaryPhoneCallingCode: NIGERIA_DIAL,
        primaryPhoneCountryCode: 'NG',
      },
      submittedAt: new Date().toISOString(),
      ...(memberId ? { memberId } : {}),
    }),
  });

  return { ok: true, status: 201, linked: Boolean(memberId) };
};

const routes = {
  'GET /healthz': async (_request, response) => {
    sendJson(response, 200, {
      status: 'ok',
      crmConfigured: missingConfig.length === 0,
    });
  },

  'GET /api/teams': async (_request, response) => {
    try {
      const teams = await getTeams();
      sendJson(response, 200, { teams });
    } catch (error) {
      sendJson(response, error.statusCode ?? 502, {
        error: 'Could not load teams from the CRM.',
      });
    }
  },

  'POST /api/orders': async (request, response) => {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return sendJson(response, error.statusCode ?? 400, {
        error: error.statusCode === 413 ? 'Request too large.' : 'Invalid request.',
      });
    }

    try {
      const result = await submitPickupOrder(body);
      if (!result.ok) {
        return sendJson(response, result.status, { errors: result.errors });
      }
      sendJson(response, 201, { ok: true });
    } catch (error) {
      sendJson(response, error.statusCode ?? 502, {
        error: 'Could not submit your order. Please try again.',
      });
    }
  },

  'POST /api/members': async (request, response) => {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return sendJson(response, error.statusCode ?? 400, {
        error: error.statusCode === 413 ? 'Request too large.' : 'Invalid request.',
      });
    }

    try {
      const result = await registerMember(body);
      if (!result.ok) {
        return sendJson(response, result.status, { errors: result.errors });
      }
      sendJson(response, 201, { ok: true });
    } catch (error) {
      sendJson(response, error.statusCode ?? 502, {
        error: 'Could not complete your registration. Please try again.',
      });
    }
  },

  'POST /api/prospects': async (request, response) => {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return sendJson(response, error.statusCode ?? 400, {
        error: error.statusCode === 413 ? 'Request too large.' : 'Invalid request.',
      });
    }

    try {
      const result = await createProspect(body);
      if (!result.ok) {
        return sendJson(response, result.status, { errors: result.errors });
      }
      sendJson(response, 201, { ok: true });
    } catch (error) {
      sendJson(response, error.statusCode ?? 502, {
        error: 'Could not save this prospect. Please try again.',
      });
    }
  },
};

const staticFiles = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/prospect': { file: 'prospect.html', type: 'text/html; charset=utf-8' },
  '/member': { file: 'member.html', type: 'text/html; charset=utf-8' },
  '/order': { file: 'order.html', type: 'text/html; charset=utf-8' },
  '/elivate-mark.png': { file: 'elivate-mark.png', type: 'image/png' },
  '/form.css': { file: 'form.css', type: 'text/css; charset=utf-8' },
};

const serveStatic = async (entry, response) => {
  try {
    const body = await readFile(path.join(publicRoot, entry.file));
    response.writeHead(200, {
      'Content-Type': entry.type,
      'Cache-Control': entry.type.startsWith('image/')
        ? 'public, max-age=86400'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
  }
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const route = routes[`${request.method} ${url.pathname}`];

  if (route) return route(request, response);

  if (request.method === 'GET') {
    const entry = staticFiles[url.pathname];
    if (entry) return serveStatic(entry, response);
  }

  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end('Not found');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[intake] listening on ${port}`);
});
