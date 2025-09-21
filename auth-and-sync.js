import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import open from 'open';
import ColorThief from 'colorthief';
import { writeFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,  // e.g. http://127.0.0.1:8080/callback
  GOVEE_API_KEY,
  GOVEE_DEVICE,
  GOVEE_MODEL
} = process.env;

const SCOPES = 'user-read-currently-playing user-read-playback-state';
const app = express();

let accessToken = null;
let refreshToken = null;
let lastTrackId = null;
let backoffUntil = 0; // ms timestamp to pause cloud calls after 429/400

const log = (...a) => console.log('[LightSync]', ...a);

/* ---------------- helpers: color math ---------------- */
const clamp8 = x => Math.max(0, Math.min(255, Math.round(x)));

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max + min) / 2;
  const d = max - min;
  if (d === 0) {
    h = 0; s = 0;
  } else {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l }; // 0..1
}

// sRGB relative luminance (perceptual)
function relLuma(r, g, b) {
  const toLin = v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const R = toLin(r), G = toLin(g), B = toLin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B; // 0..1
}

// scale brightness toward a target luminance while keeping hue
function normalizeBrightness([r,g,b], targetLuma = 0.55) {
  const y = relLuma(r,g,b);
  if (y === 0) return [60, 60, 60]; // avoid pure black
  const scale = targetLuma / y;
  return [clamp8(r*scale), clamp8(g*scale), clamp8(b*scale)];
}

/* ---------------- Spotify OAuth & API ---------------- */
function authorizeUrl(state) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state
  });
  return `https://accounts.spotify.com/authorize?${p.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: SPOTIFY_CLIENT_SECRET
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function refresh() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: SPOTIFY_CLIENT_SECRET
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  accessToken = data.access_token;
  if (data.refresh_token) refreshToken = data.refresh_token;
}

// returns null on 204 (nothing playing)
async function spotifyJson(endpoint) {
  let res = await fetch(`https://api.spotify.com/${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (res.status === 401 && refreshToken) {
    await refresh();
    res = await fetch(`https://api.spotify.com/${endpoint}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---------------- Govee Cloud helpers (with backoff) ---------------- */
async function safeGovee(cmd) {
  const now = Date.now();
  if (now < backoffUntil) return;

  const res = await fetch('https://developer-api.govee.com/v1/devices/control', {
    method: 'PUT',
    headers: {
      'Govee-API-Key': GOVEE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ device: GOVEE_DEVICE, model: GOVEE_MODEL, cmd })
  });

  if (res.status === 429) {
    const retry = parseInt(res.headers.get('retry-after') || '60', 10);
    backoffUntil = Date.now() + retry * 1000;
    log(`Backing off for ${retry}s (429)`);
    return;
  }
  if (res.status === 400) {
    backoffUntil = Date.now() + 30 * 1000;
    log('400 from Govee; pausing 30s. Body:', await res.text());
    return;
  }
  if (!res.ok) {
    log('Govee error:', res.status, await res.text());
  }
}

async function setSolidColor([r, g, b]) {
  await safeGovee({ name: 'turn', value: 'on' }); // just turn on
  await safeGovee({ name: 'color', value: { r: clamp8(r), g: clamp8(g), b: clamp8(b) } });
}

/* ---------------- Album art → natural accent color ---------------- */
async function pickAlbumColor(url) {
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  const tmp = `.album-${randomUUID()}.jpg`;
  writeFileSync(tmp, buf);

  try {
    const palette = await ColorThief.getPalette(tmp, 8);
    if (!palette || palette.length === 0) return [255, 255, 255];

    let best = palette[0], bestScore = -Infinity;
    for (const [r,g,b] of palette) {
      const { s, l } = rgbToHsl(r,g,b);
      let score = 0;
      score += s * 1.0;
      const mid = 1 - Math.abs(l - 0.5) * 2;
      score += mid * 0.7;
      if (s < 0.12) score -= 0.6;
      if (l < 0.12) score -= 0.6;
      if (l > 0.88) score -= 0.4;
      if (score > bestScore) { bestScore = score; best = [r,g,b]; }
    }

    // Natural look, normalized to ~mid brightness
    return normalizeBrightness(best, 0.55);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

/* ---------------- Track watcher ---------------- */
async function updateIfChanged() {
  const now = await spotifyJson('v1/me/player/currently-playing');
  if (!now || !now.item || now.is_playing === false) return;

  const track = now.item;
  if (track.id === lastTrackId) return;

  const img = (track.album?.images || []).sort((a, b) => b.width - a.width)[0]?.url;
  if (!img) return;

  const color = await pickAlbumColor(img);
  log(`Now playing: ${track.name} — ${track.artists.map(a => a.name).join(', ')}`);
  log(`Chosen album color: [${color.join(', ')}]`);

  await setSolidColor(color);
  log('Govee color updated.');

  lastTrackId = track.id;
}

/* ---------------- Routes ---------------- */
app.get('/login', (_req, res) => {
  const url = authorizeUrl(randomUUID());
  open(url);
  res.send('Opening Spotify login…');
});

app.get('/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) throw new Error(String(error));
    const tokens = await exchangeCode(String(code));
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;

    res.send('Authorized! You can close this tab and play a track.');
    log('Polling Spotify every 5s…');

    setInterval(() => {
      updateIfChanged().catch(e => log('Update error:', e.message));
    }, 5000);
  } catch (e) {
    log('Callback error:', e.message);
    res.status(500).send('Error during callback. Check terminal.');
  }
});

/* ---------------- Server ---------------- */
app.listen(8080, '127.0.0.1', () => {
  log('Server running on http://127.0.0.1:8080');
  log('Open  http://127.0.0.1:8080/login  to authorize Spotify.');
});
