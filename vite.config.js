import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 맵 에디터(editor.html)가 맵 파일을 읽고 저장하기 위한 개발 서버 전용 API.
// - `npm run dev`로 켰을 때만 존재하고, 배포 빌드에는 포함되지 않는다.
// - 이 컴퓨터(localhost)에서 온 요청만 허용한다 (같은 와이파이의 폰에서는 저장 불가).
function mapApi() {
  const mapsDir = path.resolve('src/maps');
  const themesDir = path.resolve('public/assets/themes');
  const okName = n => /^[A-Za-z0-9_-]{1,40}$/.test(n || '');
  return {
    name: 'map-api',
    configureServer(server) {
      server.middlewares.use('/__api', (req, res, next) => {
        const ip = req.socket.remoteAddress || '';
        if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) { res.statusCode = 403; return res.end('local only'); }
        const url = new URL(req.url, 'http://x');
        const send = (obj, code = 200) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
        const name = url.searchParams.get('name');
        if (url.pathname === '/maps' && req.method === 'GET')
          return send(fs.readdirSync(mapsDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort());
        if (url.pathname === '/themes' && req.method === 'GET')
          return send(fs.readdirSync(themesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name));
        if (url.pathname === '/map' && req.method === 'GET') {
          if (!okName(name)) return send({ error: 'bad name' }, 400);
          const f = path.join(mapsDir, name + '.json');
          return fs.existsSync(f) ? send(JSON.parse(fs.readFileSync(f, 'utf8'))) : send({ error: 'not found' }, 404);
        }
        if (url.pathname === '/map' && req.method === 'POST') {
          if (!okName(name)) return send({ error: 'bad name' }, 400);
          let body = '';
          req.on('data', c => { body += c; if (body.length > 200000) req.destroy(); });
          req.on('end', () => {
            try {
              const m = JSON.parse(body);
              if (!Array.isArray(m.grid) || !m.grid.every(r => typeof r === 'string')) throw new Error('grid 형식 오류');
              fs.writeFileSync(path.join(mapsDir, name + '.json'), JSON.stringify(m, null, 2) + '\n');
              send({ ok: true });
            } catch (e) { send({ error: String(e.message || e) }, 400); }
          });
          return;
        }
        next();
      });
    },
  };
}

// base './' : GitHub Pages 같은 하위 경로에 올려도 동작하게
// 빌드(배포)에는 index.html만 포함 -> 맵 에디터는 지인에게 노출되지 않음
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [mapApi()],
  server: { host: true, port: 5173 },
  // 게임 버전: 배포(빌드)할 때마다 시각으로 바뀜 → 버전이 다른 사람끼리는 같은 방에 못 들어감
  define: { __APP_VERSION__: JSON.stringify(command === 'build' ? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') : 'dev') },
}));
