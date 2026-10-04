import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directories
const DATA_DIR = path.join(__dirname, 'data');
const KEYS_DIR = path.join(DATA_DIR, 'keys');
const SKINS_DIR = path.join(DATA_DIR, 'skins');
const CAPES_DIR = path.join(DATA_DIR, 'capes');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

for (const dir of [DATA_DIR, KEYS_DIR, SKINS_DIR, CAPES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 1. Persistent RSA-4096 Keys
const PRIV_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUB_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

let privateKeyObject;
let publicKeyPEM = '';

if (fs.existsSync(PRIV_KEY_PATH) && fs.existsSync(PUB_KEY_PATH)) {
  const privPEM = fs.readFileSync(PRIV_KEY_PATH, 'utf-8');
  publicKeyPEM = fs.readFileSync(PUB_KEY_PATH, 'utf-8');
  privateKeyObject = crypto.createPrivateKey(privPEM);
  console.log('[Keys] Loaded existing persistent RSA-4096 keypair.');
} else {
  console.log('[Keys] Generating new RSA-4096 keypair for texture signatures...');
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
  privateKeyObject = keyPair.privateKey;
  publicKeyPEM = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPEM = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  fs.writeFileSync(PRIV_KEY_PATH, privPEM, 'utf-8');
  fs.writeFileSync(PUB_KEY_PATH, publicKeyPEM, 'utf-8');
  console.log('[Keys] Generated and saved RSA-4096 keypair.');
}

// 2. Profiles storage
let profiles = {};
if (fs.existsSync(PROFILES_FILE)) {
  try {
    profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
  } catch (e) {
    profiles = {};
  }
}

function saveProfiles() {
  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save profiles.json:', e);
  }
}

// Helper to clean UUID
function cleanUuid(uuid) {
  return (uuid || '').replace(/-/g, '').toLowerCase();
}

// HTTP Server
const PORT = process.env.PORT || 10000;

const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const method = req.method || 'GET';

  // Base URL & Host
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const rawHost = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const host = rawHost.split(':')[0];
  const baseUrl = `${proto}://${rawHost}`;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- HTML LANDING PAGE (for browsers) ---
  if ((url === '/' || url === '') && req.headers['accept']?.includes('text/html')) {
    const playerCount = Object.keys(profiles).length;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="utf-8">
        <title>Shy Skin Server</title>
        <style>
          body {
            margin: 0;
            background: #0A0A0F;
            color: #FFFFFF;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 40px;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 20px 50px rgba(108, 92, 231, 0.2);
          }
          h1 { margin: 0 0 10px; font-size: 32px; font-weight: 300; }
          .badge {
            display: inline-block;
            background: rgba(0, 184, 148, 0.2);
            color: #00B894;
            border: 1px solid rgba(0, 184, 148, 0.4);
            padding: 6px 14px;
            border-radius: 99px;
            font-size: 13px;
            margin-bottom: 20px;
          }
          p { color: rgba(255, 255, 255, 0.6); line-height: 1.6; }
          .code {
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 12px;
            font-family: monospace;
            font-size: 13px;
            color: #A29BFE;
            word-break: break-all;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🌙 Shy Skin Cloud</h1>
          <div class="badge">● Online & Ready</div>
          <p>Официальный сервер синхронизации скинов и плащей для лаунчера Shy.</p>
          <p>Зарегистрировано скинов игроков: <strong>${playerCount}</strong></p>
          <div class="code">${baseUrl}</div>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // --- 1. YGGDRASIL ROOT METADATA (/ or /api) ---
  if (url === '/' || url === '/api' || url.startsWith('/?')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        meta: {
          serverName: 'Shy Skin Server',
          implementationName: 'shy-skin-server',
          implementationVersion: '1.0.0',
        },
        skinDomains: [
          'localhost',
          '127.0.0.1',
          'onrender.com',
          host,
          'textures.minecraft.net',
          'ely.by',
          'skinsystem.ely.by',
        ],
        signaturePublickey: publicKeyPEM,
      })
    );
    return;
  }

  // --- 2. YGGDRASIL PROFILE TEXTURES QUERY ---
  if (
    url.startsWith('/sessionserver/session/minecraft/profile/') ||
    url.startsWith('/session/minecraft/profile/')
  ) {
    const parts = url.split('?')[0].split('/');
    const queriedUuid = cleanUuid(parts[parts.length - 1]);

    // Check if we have this profile or find by UUID
    let profile = profiles[queriedUuid];
    if (!profile) {
      // Check if any profile has this username or if queriedUuid matches
      profile = Object.values(profiles).find((p) => cleanUuid(p.uuid) === queriedUuid);
    }

    if (!profile || !profile.hasSkin) {
      // If no custom skin uploaded on Shy server, return 204 No Content
      res.writeHead(204);
      res.end();
      return;
    }

    const username = profile.username || 'Player';
    const model = profile.model || 'default';

    const texturesObj = {
      timestamp: Date.now(),
      profileId: queriedUuid,
      profileName: username,
      signatureRequired: true,
      textures: {
        SKIN: {
          url: `${baseUrl}/textures/${queriedUuid}/skin.png`,
          ...(model === 'slim' ? { metadata: { model: 'slim' } } : {}),
        },
      },
    };

    if (profile.hasCape) {
      texturesObj.textures.CAPE = {
        url: `${baseUrl}/textures/${queriedUuid}/cape.png`,
      };
    }

    const base64Value = Buffer.from(JSON.stringify(texturesObj)).toString('base64');
    const signer = crypto.createSign('SHA1');
    signer.update(base64Value);
    const signature = signer.sign(privateKeyObject, 'base64');

    const profileResponse = {
      id: queriedUuid,
      name: username,
      properties: [
        {
          name: 'textures',
          value: base64Value,
          signature,
        },
      ],
    };

    console.log(`[Profile] Served textures for ${username} (${queriedUuid})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(profileResponse));
    return;
  }

  // --- 3. hasJoined & join checks ---
  if (url.includes('/hasJoined')) {
    const match = url.match(/[?&]username=([^&]+)/);
    const username = match ? decodeURIComponent(match[1]) : 'Player';
    const profile = Object.values(profiles).find((p) => p.username.toLowerCase() === username.toLowerCase());

    if (profile) {
      const qUuid = cleanUuid(profile.uuid);
      const texturesObj = {
        timestamp: Date.now(),
        profileId: qUuid,
        profileName: username,
        signatureRequired: true,
        textures: {
          SKIN: {
            url: `${baseUrl}/textures/${qUuid}/skin.png`,
            ...(profile.model === 'slim' ? { metadata: { model: 'slim' } } : {}),
          },
        },
      };

      if (profile.hasCape) {
        texturesObj.textures.CAPE = { url: `${baseUrl}/textures/${qUuid}/cape.png` };
      }

      const base64Value = Buffer.from(JSON.stringify(texturesObj)).toString('base64');
      const signer = crypto.createSign('SHA1');
      signer.update(base64Value);
      const signature = signer.sign(privateKeyObject, 'base64');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: qUuid,
        name: username,
        properties: [{ name: 'textures', value: base64Value, signature }],
      }));
      return;
    }

    res.writeHead(204);
    res.end();
    return;
  }

  if (url.includes('/join')) {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- 4. Profile by username ---
  if (url.startsWith('/users/profiles/minecraft/')) {
    const parts = url.split('?')[0].split('/');
    const queriedName = decodeURIComponent(parts[parts.length - 1]);
    const profile = Object.values(profiles).find((p) => p.username.toLowerCase() === queriedName.toLowerCase());

    if (profile) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: cleanUuid(profile.uuid),
        name: profile.username,
      }));
      return;
    }

    res.writeHead(204);
    res.end();
    return;
  }

  // --- 5. SERVE SKIN PNG (/textures/:uuid/skin.png) ---
  const skinMatch = url.match(/^\/textures\/([a-f0-9]+)\/skin\.png/);
  if (skinMatch) {
    const uuid = skinMatch[1];
    const skinPath = path.join(SKINS_DIR, `${uuid}.png`);
    if (fs.existsSync(skinPath)) {
      const imgBuf = fs.readFileSync(skinPath);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': imgBuf.length,
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(imgBuf);
      return;
    }
    res.writeHead(404);
    res.end();
    return;
  }

  // --- 6. SERVE CAPE PNG (/textures/:uuid/cape.png) ---
  const capeMatch = url.match(/^\/textures\/([a-f0-9]+)\/cape\.png/);
  if (capeMatch) {
    const uuid = capeMatch[1];
    const capePath = path.join(CAPES_DIR, `${uuid}.png`);
    if (fs.existsSync(capePath)) {
      const imgBuf = fs.readFileSync(capePath);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': imgBuf.length,
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(imgBuf);
      return;
    }
    res.writeHead(404);
    res.end();
    return;
  }

  // --- 7. REST API: UPLOAD SKIN FROM SHY LAUNCHER ---
  if (url === '/api/skins/upload' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        // 5MB limit
        res.writeHead(413);
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { username, uuid, model, skinBase64, capeBase64 } = payload;

        if (!username || !skinBase64) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing username or skinBase64' }));
          return;
        }

        const safeUuid = cleanUuid(uuid || crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest('hex'));

        // Save skin PNG
        const cleanSkinData = skinBase64.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(path.join(SKINS_DIR, `${safeUuid}.png`), Buffer.from(cleanSkinData, 'base64'));

        // Save cape PNG if provided
        let hasCape = false;
        if (capeBase64) {
          const cleanCapeData = capeBase64.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(CAPES_DIR, `${safeUuid}.png`), Buffer.from(cleanCapeData, 'base64'));
          hasCape = true;
        }

        profiles[safeUuid] = {
          username,
          uuid: safeUuid,
          model: model === 'slim' ? 'slim' : 'default',
          hasSkin: true,
          hasCape,
          updatedAt: Date.now(),
        };

        saveProfiles();

        console.log(`[Upload] Updated skin for ${username} (${safeUuid})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            skinUrl: `${baseUrl}/textures/${safeUuid}/skin.png`,
            capeUrl: hasCape ? `${baseUrl}/textures/${safeUuid}/cape.png` : undefined,
          })
        );
      } catch (err) {
        console.error('Error handling skin upload:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  // --- 8. REST API: GET PROFILES ---
  if (url === '/api/profiles' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, profiles }));
    return;
  }

  // --- 9. HEALTH CHECK ---
  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', playersCount: Object.keys(profiles).length }));
    return;
  }

  // 404
  res.writeHead(404);
  res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Shy Skin Server] Listening on 0.0.0.0:${PORT}`);
});
