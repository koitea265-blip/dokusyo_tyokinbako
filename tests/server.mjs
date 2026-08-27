/*!
 * テスト用の ちいさな静的サーバー（依存パッケージなし）
 *
 * manifest.json の scope が /Reading-Books/ なので、
 * かならず リポジトリ名の ディレクトリの下で 配信する必要がある。
 * （ルートで配信すると Service Worker の scope が合わず、
 *   オフラインの検査が 本番と ちがう条件になってしまう）
 *
 * オフラインの検査では stop() で 本当に サーバーを 止める。
 * ブラウザの「オフライン疑似」は ページ遷移を Service Worker より手前で
 * 止めてしまい、キャッシュから返せているかを 確かめられなかったため。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.ico':  'image/x-icon'
};

// 本番と同じ「ドメイン直下」で配る。
// 専用ドメイン reading-books.giga-school.com ではアプリがドメイン直下に
// 置かれるので、ここを旧構成の '/Reading-Books/' にすると、
// 本番では 404 になるパスがテスト環境でだけ通ってしまう。
export const BASE_PATH = '/';

export async function startServer(root, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(BASE_PATH)) { res.writeHead(404).end('not found'); return; }

      let rel = decodeURIComponent(url.pathname.slice(BASE_PATH.length)) || 'index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      // ディレクトリを さかのぼる細工を はじく
      const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
      const file = join(root, safe);
      if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }

      const info = await stat(file).catch(() => null);
      if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }

      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-cache'
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;

  return {
    origin: `http://127.0.0.1:${actual}`,
    url: `http://127.0.0.1:${actual}${BASE_PATH}`,
    /** 本当に止める（圏外と同じ状態にする） */
    stop: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); })
  };
}
