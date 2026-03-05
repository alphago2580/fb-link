// /api/shorten?url=... (GET)
// 북마클릿용 통합 엔드포인트: 크롤 + Redis 저장 + 단축 URL 반환
// CORS 허용 (Facebook/Instagram 페이지에서 fetch 가능)

const ALLOWED_HOSTS = [
  'facebook.com', 'www.facebook.com', 'm.facebook.com',
  'fb.com', 'web.facebook.com', 'fb.me', 'fb.watch',
  'instagram.com', 'www.instagram.com',
];

function isAllowedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (!isAllowedUrl(url)) return res.status(400).json({ error: 'Not an allowed URL' });

  const isIgUrl = u => u.includes('instagram.com');

  const unesc = s => String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  const parseOG = html => {
    const m = prop =>
      (html.match(new RegExp(`property="${prop}"[^>]*content="([^"]*)"`, 'i')) ||
       html.match(new RegExp(`content="([^"]*)"[^>]*property="${prop}"`, 'i')))?.[1] || '';
    return { title: unesc(m('og:title')), img: unesc(m('og:image')), desc: unesc(m('og:description')) };
  };

  const UAS = isIgUrl(url) ? [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Twitterbot/1.0)',
  ] : [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Facebot Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Twitterbot/1.0)',
  ];

  let title = '', img = '';

  for (const ua of UAS) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(7000),
      });
      const html = await r.text();
      const og = parseOG(html);
      if (og.title || og.img) { title = og.title; img = og.img; break; }
    } catch(e) { continue; }
  }

  // Redis 저장
  const id = Math.random().toString(36).slice(2, 8);
  try {
    await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', `fl:${id}`, JSON.stringify({ url, title, img }), 'EX', '604800']),
    });
  } catch(e) {
    // Redis 실패 시 og 방식으로 폴백
    const params = new URLSearchParams({ url });
    if (title) params.set('title', title);
    if (img) params.set('img', img);
    const host = req.headers.host || '';
    const proto = host.includes('localhost') ? 'http' : 'https';
    return res.json({ shortUrl: `${proto}://${host}/api/og?${params}` });
  }

  const host = req.headers.host || '';
  const proto = host.includes('localhost') ? 'http' : 'https';
  res.json({ shortUrl: `${proto}://${host}/api/s/${id}` });
}
