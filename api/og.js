// 허용 도메인 (SSRF 방지)
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

const isSharePUrl = u => /facebook\.com\/share\/(p|v|r)\//.test(u);
const isIgUrl = u => u.includes('instagram.com');
const isLoginPage = html => /login|checkpoint|로그인\s*또는\s*가입/i.test(html.slice(0, 3000));

export default async function handler(req, res) {
  const { url, title: pTitle, desc: pDesc, img: pImg } = req.query;
  if (!url) return res.status(400).send('Missing url parameter');
  if (!isAllowedUrl(url)) return res.status(400).send('Invalid url');

  const escape = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const unesc = s => String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');

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
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)',
  ];

  let title = pTitle || '';
  let desc = pDesc || '';
  let img = pImg || '';

  if (!img) {
    const tryFetch = async (targetUrl, ua) => {
      const r = await fetch(targetUrl, {
        headers: {
          'User-Agent': ua,
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(7000),
      });
      return { html: await r.text(), finalUrl: r.url || targetUrl };
    };

    outer:
    for (const ua of UAS) {
      try {
        let { html, finalUrl } = await tryFetch(url, ua);

        // 로그인 페이지 → next= 파라미터에서 실제 URL 추출 후 재시도
        if (isLoginPage(html)) {
          try {
            const nextUrl = new URL(finalUrl).searchParams.get('next');
            if (nextUrl && isAllowedUrl(nextUrl)) {
              const r2 = await tryFetch(nextUrl, ua);
              if (!isLoginPage(r2.html)) html = r2.html;
            }
          } catch(e) {}
          if (isLoginPage(html)) continue;
        }

        // share/p/ → canonical 해소 시도
        if (isSharePUrl(finalUrl) || isSharePUrl(url)) {
          const og = parseOG(html);
          if (og.img) { title = title || og.title; img = og.img; desc = desc || og.desc; break outer; }
          // canonical URL에서 재시도
          try {
            const canonUrl = new URL(finalUrl);
            const nextUrl = canonUrl.searchParams.get('next');
            if (nextUrl && isAllowedUrl(nextUrl)) {
              const r3 = await tryFetch(nextUrl, 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)');
              const og2 = parseOG(r3.html);
              if (og2.img) { title = title || og2.title; img = og2.img; desc = desc || og2.desc; break outer; }
            }
          } catch(e) {}
          continue;
        }

        const og = parseOG(html);
        if (og.title || og.img) {
          title = title || og.title;
          img = og.img;
          desc = desc || og.desc;
          break;
        }
      } catch(e) { continue; }
    }
  }

  const host = req.headers.host || '';
  const protocol = host.includes('localhost') ? 'http' : 'https';

  // lookaside/fbsbx 이미지 → 프록시
  if (img && img.includes('fbsbx.com')) {
    const midMatch = img.match(/media_id=(\d+)/);
    img = midMatch
      ? `${protocol}://${host}/api/img?mid=${midMatch[1]}`
      : `${protocol}://${host}/api/img?url=${encodeURIComponent(img)}`;
  }
  // fbcdn 이미지 → 프록시
  if (img && img.includes('fbcdn.net')) {
    img = `${protocol}://${host}/api/img?url=${encodeURIComponent(img)}`;
  }

  title = title || (isIgUrl(url) ? 'Instagram 게시물' : 'Facebook 게시물');
  const platformColor = isIgUrl(url) ? '#c13584' : '#1877f2';
  const platformName = isIgUrl(url) ? '인스타그램' : '페이스북';

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(title)}</title>
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(desc)}">
  <meta property="og:image" content="${escape(img)}">
  <meta property="og:url" content="${escape(url)}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(title)}">
  <meta name="twitter:description" content="${escape(desc)}">
  <meta name="twitter:image" content="${escape(img)}">
  <meta http-equiv="refresh" content="0;url=${escape(url)}">
</head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f0f2f5;margin:0;">
  <div style="text-align:center;color:#666;">
    <p style="margin-bottom:8px;">${platformName}으로 이동 중...</p>
    <a href="${escape(url)}" style="color:${platformColor};font-size:14px;">바로가기</a>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.status(200).send(html);
}
