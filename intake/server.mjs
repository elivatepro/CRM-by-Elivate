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
const opportunityObject = process.env.TWENTY_OPPORTUNITY_OBJECT ?? 'opportunities';

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
  '/': { file: 'prospect.html', type: 'text/html; charset=utf-8' },
  '/prospect': { file: 'prospect.html', type: 'text/html; charset=utf-8' },
  '/elivate-mark.png': { file: 'elivate-mark.png', type: 'image/png' },
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
