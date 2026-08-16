// ─────────────────────────────────────────────────────────────────────────────
// Flynn Bertsch Portfolio — Admin API Worker
// Cloudflare Worker: Auth + GitHub-Proxy
// ─────────────────────────────────────────────────────────────────────────────

const REPO   = 'flynn-com/Webseite2.0';
const BRANCH = 'main';

// Das Admin-Panel darf NUR diese Pfade lesen/schreiben/löschen - alles andere
// (z.B. .github/workflows/, workers/, package.json) bleibt tabu, selbst mit
// gültigem Admin-Token. Verhindert, dass eine kompromittierte Session (z.B.
// via gestohlenes Token) das komplette Repo statt nur den Content übernimmt.
const ALLOWED_PATH_PREFIXES = [
  'src/content/projects/',
  'src/content/about/',
  'src/content/contact/',
  'src/content/imprint/',
  'src/content/privacy/',
  'public/uploads/',
];
const ALLOWED_EXACT_PATHS = ['src/data/seo.json'];

function isAllowedPath(path) {
  if (typeof path !== 'string' || !path || path.includes('..')) return false;
  if (ALLOWED_EXACT_PATHS.includes(path)) return true;
  return ALLOWED_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = [
      env.ALLOWED_ORIGIN || 'https://flynnbertsch.com',
      'http://localhost:4321',
      'http://localhost:3000',
      'http://localhost:8080',
    ];
    const corsOrigin = allowed.includes(origin) ? origin : (allowed[0]);
    const cors = {
      'Access-Control-Allow-Origin':  corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age':       '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      let res;

      // ── Public endpoints ──────────────────────────────────────────────────
      if (path === '/auth/login'          && request.method === 'POST') res = await handleLogin(request, env);
      else if (path === '/auth/logout'    && request.method === 'POST') res = await handleLogout(request, env);
      else if (path === '/auth/reset-request'  && request.method === 'POST') res = await handleResetRequest(request, env);
      else if (path === '/auth/reset-confirm'  && request.method === 'POST') res = await handleResetConfirm(request, env);
      else if (path === '/setup'          && request.method === 'POST') res = await handleSetup(request, env);

      // ── Protected GitHub endpoints ────────────────────────────────────────
      else if (path.startsWith('/github/')) {
        const session = await checkAuth(request, env);
        if (!session) return addCors(json({ error: 'Nicht eingeloggt' }, 401), cors);

        if      (path === '/github/file'   && request.method === 'GET')    res = await ghGetFile(request, env);
        else if (path === '/github/file'   && request.method === 'PUT')    res = await ghPutFile(request, env);
        else if (path === '/github/file'   && request.method === 'DELETE') res = await ghDeleteFile(request, env);
        else if (path === '/github/tree'   && request.method === 'GET')    res = await ghGetTree(request, env);
        else if (path === '/github/upload' && request.method === 'POST')   res = await ghUpload(request, env);
        else res = json({ error: 'Not found' }, 404);
      }

      else res = json({ error: 'Not found' }, 404);

      return addCors(res, cors);
    } catch (err) {
      console.error(err);
      return addCors(json({ error: err.message || 'Internal error' }, 500), cors);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Encode each path segment so non-ASCII chars (é, ®, etc.) work with GitHub API
function ghPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function addCors(response, cors) {
  const r = new Response(response.body, response);
  Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}

function randomHex(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hashBuf = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
}

async function checkAuth(request, env) {
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const session = await env.ADMIN_KV.get(`session:${token}`);
  return session ? JSON.parse(session) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
// ─────────────────────────────────────────────────────────────────────────────

async function handleSetup(request, env) {
  const existing = await env.ADMIN_KV.get('credentials');
  if (existing) return json({ error: 'Admin bereits eingerichtet' }, 409);

  // Falls konfiguriert (empfohlen, via `wrangler secret put SETUP_SECRET`):
  // ohne das korrekte Secret kann niemand die Erstanmeldung an sich reißen,
  // z.B. falls der KV-Namespace jemals versehentlich geleert wird.
  if (env.SETUP_SECRET) {
    const provided = request.headers.get('X-Setup-Secret') || '';
    if (provided !== env.SETUP_SECRET) return json({ error: 'Ungültiges Setup-Secret' }, 403);
  }

  const { username, password } = await request.json();
  if (!username || !password)    return json({ error: 'username und password erforderlich' }, 400);
  if (password.length < 8)       return json({ error: 'Passwort muss mindestens 8 Zeichen haben' }, 400);

  const salt         = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(password, salt);
  const saltB64      = btoa(String.fromCharCode(...salt));

  await env.ADMIN_KV.put('credentials', JSON.stringify({ username, passwordHash, salt: saltB64 }));
  return json({ ok: true });
}

const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MS        = 15 * 60 * 1000; // 15 min Sperre
const LOGIN_WINDOW_MS         = 30 * 60 * 1000; // Zähler verfällt nach 30 min Ruhe

async function handleLogin(request, env) {
  const { username, password } = await request.json();

  // Pro IP gesperrt statt global - sonst kann jeder Anonyme mit 5 Fehlversuchen
  // den echten Admin 15 Minuten lang aus dem eigenen Panel aussperren.
  const ip     = request.headers.get('CF-Connecting-IP') || 'unknown';
  const attKey = `failed_attempts:${ip}`;
  const attRaw   = await env.ADMIN_KV.get(attKey);
  const att      = attRaw ? JSON.parse(attRaw) : { count: 0, lastAttempt: 0 };
  const sinceLast = Date.now() - att.lastAttempt;

  // Aktive Sperre nach zu vielen Fehlversuchen
  if (att.count >= LOGIN_LOCKOUT_THRESHOLD && sinceLast < LOGIN_LOCKOUT_MS) {
    const waitMin = Math.ceil((LOGIN_LOCKOUT_MS - sinceLast) / 60000);
    return json({ error: `Zu viele Fehlversuche. Bitte in ${waitMin} Minute(n) erneut versuchen.`, locked: true }, 429);
  }

  // Zähler verfällt nach Ruhephase (auch nach abgelaufener Sperre)
  if (sinceLast > LOGIN_WINDOW_MS || (att.count >= LOGIN_LOCKOUT_THRESHOLD && sinceLast >= LOGIN_LOCKOUT_MS)) {
    att.count = 0;
  }

  const credsRaw = await env.ADMIN_KV.get('credentials');
  if (!credsRaw) return json({ error: 'Kein Admin konfiguriert' }, 503);

  const { username: storedUser, passwordHash, salt: saltB64 } = JSON.parse(credsRaw);
  const salt   = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const hash   = await hashPassword(password, salt);
  const valid  = username === storedUser && hash === passwordHash;

  if (!valid) {
    att.count++;
    att.lastAttempt = Date.now();
    await env.ADMIN_KV.put(attKey, JSON.stringify(att));
    return json({ error: 'Benutzername oder Passwort falsch' }, 401);
  }

  // Create session (24 h)
  const token = randomHex(32);
  await env.ADMIN_KV.put(`session:${token}`, JSON.stringify({ createdAt: Date.now() }), { expirationTtl: 86400 });
  await env.ADMIN_KV.delete(attKey);

  return json({ token });
}

async function handleLogout(request, env) {
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token) await env.ADMIN_KV.delete(`session:${token}`);
  return json({ ok: true });
}

const RESET_REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // max. 1 Reset-Mail alle 5 min

async function handleResetRequest(request, env) {
  const lastReq = await env.ADMIN_KV.get('last_reset_request');
  if (lastReq && Date.now() - Number(lastReq) < RESET_REQUEST_COOLDOWN_MS) {
    return json({ error: 'Es wurde bereits kürzlich eine Reset-Mail versendet. Bitte prüfe dein Postfach oder warte ein paar Minuten.' }, 429);
  }

  // Generate reset token (1 h)
  const token = randomHex(32);
  await env.ADMIN_KV.put(`reset:${token}`, JSON.stringify({ createdAt: Date.now() }), { expirationTtl: 3600 });

  const origin   = env.ALLOWED_ORIGIN || 'https://flynnbertsch.com';
  const resetUrl = `${origin}/admin/#reset?token=${token}`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from:    `Flynn Admin <noreply@flynnbertsch.com>`,
      to:      [env.ADMIN_EMAIL],
      subject: 'Admin-Passwort zurücksetzen',
      html:    `
        <div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:32px;background:#111;color:#e8e8e8;border-radius:8px;">
          <h2 style="margin:0 0 16px;font-size:1.25rem;">Passwort zurücksetzen</h2>
          <p style="margin:0 0 24px;color:#aaa;">Du hast eine Passwort-Rücksetz-Anfrage für deine Admin-Seite gestellt.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#fff;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Passwort jetzt zurücksetzen</a>
          <p style="margin:24px 0 0;font-size:0.8rem;color:#666;">Dieser Link ist 1 Stunde gültig.<br>Falls du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail.</p>
        </div>`,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error('Resend error:', err);
    return json({ error: 'E-Mail konnte nicht gesendet werden' }, 500);
  }

  await env.ADMIN_KV.put('last_reset_request', String(Date.now()));
  return json({ ok: true });
}

async function handleResetConfirm(request, env) {
  const { token, password } = await request.json();
  if (!token || !password)  return json({ error: 'token und password erforderlich' }, 400);
  if (password.length < 8)  return json({ error: 'Passwort muss mindestens 8 Zeichen haben' }, 400);

  const resetData = await env.ADMIN_KV.get(`reset:${token}`);
  if (!resetData) return json({ error: 'Ungültiger oder abgelaufener Reset-Link' }, 400);

  const existing = await env.ADMIN_KV.get('credentials');
  const creds    = existing ? JSON.parse(existing) : {};

  const salt         = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(password, salt);
  const saltB64      = btoa(String.fromCharCode(...salt));

  await env.ADMIN_KV.put('credentials', JSON.stringify({ ...creds, passwordHash, salt: saltB64 }));
  await env.ADMIN_KV.delete(`reset:${token}`);

  return json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub API helpers
// ─────────────────────────────────────────────────────────────────────────────

function ghHeaders(env) {
  return {
    Authorization:       `token ${env.GITHUB_TOKEN}`,
    Accept:              'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':        'Flynn-Admin-Worker/1.0',
  };
}

async function ghGetCurrentSha(path, env) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${ghPath(path)}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: ghHeaders(env) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

async function ghGetFile(request, env) {
  const url  = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) return json({ error: 'path erforderlich' }, 400);
  if (!isAllowedPath(path)) return json({ error: 'Pfad nicht erlaubt' }, 403);

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${ghPath(path)}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: ghHeaders(env) }
  );

  if (res.status === 404) return json({ exists: false, content: null, sha: null });
  if (!res.ok) return json({ error: `GitHub ${res.status}` }, res.status);

  const data    = await res.json();
  // GitHub returns base64 with newlines — decode to UTF-8 string
  const raw     = data.content.replace(/\n/g, '');
  const bytes   = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  const content = new TextDecoder().decode(bytes);

  return json({ exists: true, content, sha: data.sha });
}

async function ghPutFile(request, env) {
  const { path, content, message, sha: providedSha } = await request.json();
  if (!path || content === undefined) return json({ error: 'path und content erforderlich' }, 400);
  if (!isAllowedPath(path)) return json({ error: 'Pfad nicht erlaubt' }, 403);

  let sha = providedSha || await ghGetCurrentSha(path, env);

  // Encode UTF-8 content to base64
  const bytes  = new TextEncoder().encode(content);
  const b64    = btoa(String.fromCharCode(...bytes));

  const body   = { message: message || `update: ${path}`, content: b64, branch: BRANCH };
  if (sha) body.sha = sha;

  let res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${ghPath(path)}`,
    { method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  // 409 = SHA conflict → retry with fresh SHA
  if (res.status === 409) {
    body.sha = await ghGetCurrentSha(path, env);
    res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${ghPath(path)}`,
      { method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
  }

  if (!res.ok) return json({ error: `GitHub ${res.status}: ${await res.text()}` }, res.status);
  return json({ ok: true });
}

async function ghDeleteFile(request, env) {
  const { path, message } = await request.json();
  if (!path) return json({ error: 'path erforderlich' }, 400);
  if (!isAllowedPath(path)) return json({ error: 'Pfad nicht erlaubt' }, 403);

  const sha = await ghGetCurrentSha(path, env);
  if (!sha) return json({ ok: true }); // File doesn't exist

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${ghPath(path)}`,
    {
      method:  'DELETE',
      headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: message || `delete: ${path}`, sha, branch: BRANCH }),
    }
  );

  if (!res.ok) return json({ error: `GitHub ${res.status}` }, res.status);
  return json({ ok: true });
}

async function ghGetTree(request, env) {
  const url  = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) return json({ error: 'path erforderlich' }, 400);
  if (!isAllowedPath(path)) return json({ error: 'Pfad nicht erlaubt' }, 403);

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${ghPath(path)}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: ghHeaders(env) }
  );

  if (res.status === 404) return json({ files: [] });
  if (!res.ok) return json({ error: `GitHub ${res.status}` }, res.status);

  const data  = await res.json();
  const files = Array.isArray(data)
    ? data.map(f => ({ name: f.name, path: f.path, sha: f.sha, type: f.type }))
    : [];

  return json({ files });
}

async function ghUpload(request, env) {
  const { path, base64, message } = await request.json();
  if (!path || !base64) return json({ error: 'path und base64 erforderlich' }, 400);
  if (!isAllowedPath(path)) return json({ error: 'Pfad nicht erlaubt' }, 403);

  let sha  = await ghGetCurrentSha(path, env);
  const body = { message: message || `upload: ${path.split('/').pop()}`, content: base64, branch: BRANCH };
  if (sha) body.sha = sha;

  let res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${ghPath(path)}`,
    { method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  if (res.status === 409) {
    body.sha = await ghGetCurrentSha(path, env);
    res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${ghPath(path)}`,
      { method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
  }

  if (!res.ok) return json({ error: `GitHub ${res.status}: ${await res.text()}` }, res.status);

  // Return the public URL path
  const pubPath = '/' + path.replace(/^public\//, '');
  return json({ ok: true, path: pubPath });
}
