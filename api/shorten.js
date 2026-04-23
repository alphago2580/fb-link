// /api/shorten?url=... (GET)
// 북마클릿용 통합 엔드포인트: 크롤 + Redis 저장 + 단축 URL 반환
// CORS 허용 (Facebook/Instagram 페이지에서 fetch 가능)

// SSRF 방지: 사설/루프백 주소 차단, 공개 http(s) URL은 모두 허용
function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    if (!h) return false;
    if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '[::1]') return false;
    const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      const a = +ipv4[1], b = +ipv4[2];
      if (a === 10 || a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 0 || a >= 224) return false;
    }
    if (/^(fc|fd|fe80)/.test(h)) return false;
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (!isSafeUrl(url)) return res.status(400).json({ error: 'Invalid url' });

  const isIgUrl = u => u.includes('instagram.com');
  const isFbUrl = u => u.includes('facebook.com') || u.includes('fb.me') || u.includes('fb.watch');

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

  const parseFallbackTitle = html => {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? unesc(m[1]).trim() : '';
  };

  const UAS = isIgUrl(url) ? [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Twitterbot/1.0)',
  ] : isFbUrl(url) ? [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Facebot Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Twitterbot/1.0)',
  ] : [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Twitterbot/1.0)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  ];

  let title = '', img = '', desc = '';

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
      if (og.title || og.img) { title = og.title; img = og.img; desc = og.desc; break; }
      // OG 태그 없으면 <title>이라도 챙기기
      if (!title) {
        const t = parseFallbackTitle(html);
        if (t) title = t;
      }
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
      body: JSON.stringify(['SET', `fl:${id}`, JSON.stringify({ url, title, img, desc }), 'EX', '604800']),
    });
  } catch(e) {
    // Redis 실패 시 og 방식으로 폴백
    const params = new URLSearchParams({ url });
    if (title) params.set('title', title);
    if (img) params.set('img', img);
    if (desc) params.set('desc', desc);
    const host = req.headers.host || '';
    const proto = host.includes('localhost') ? 'http' : 'https';
    return res.json({ shortUrl: `${proto}://${host}/api/og?${params}` });
  }

  const host = req.headers.host || '';
  const proto = host.includes('localhost') ? 'http' : 'https';
  res.json({ shortUrl: `${proto}://${host}/api/s/${id}` });
}
