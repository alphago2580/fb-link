// 허용 도메인 (SSRF 방지)
const ALLOWED_HOSTS = [
  'facebook.com', 'www.facebook.com', 'm.facebook.com',
  'fb.com', 'web.facebook.com',
];

function isAllowedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false; // javascript: 등 차단
    return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const { url, title: pTitle, desc: pDesc, img: pImg } = req.query;
  if (!url) return res.status(400).send('Missing url parameter');

  // SSRF + XSS(javascript:) 방지
  if (!isAllowedUrl(url)) {
    return res.status(400).send('Invalid url: only Facebook URLs are allowed');
  }

  const escape = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const unescapeHtml = (s) =>
    String(s || '')
      .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");

  let title = pTitle || '';
  let desc = pDesc || '';
  let img = pImg || '';

  // img 없으면 서버에서 fetch해서 img 획득 (title은 파라미터 우선)
  if (!img) {
    const isLoginPage = h => /login|checkpoint|로그인\s*또는\s*가입/i.test(h.slice(0, 3000));
    const fbFetch = async (u) => {
      const r = await fetch(u, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      return { html: await r.text(), finalUrl: r.url || u };
    };

    try {
      let { html, finalUrl } = await fbFetch(url);

      // 로그인 페이지 → next= 파라미터에서 실제 URL 추출 후 재시도
      if (isLoginPage(html)) {
        try {
          const nextUrl = new URL(finalUrl).searchParams.get('next');
          if (nextUrl && isAllowedUrl(nextUrl)) {
            const r2 = await fbFetch(nextUrl);
            if (!isLoginPage(r2.html)) html = r2.html;
          }
        } catch(e) {}
      }

      const getOG = (prop) => {
        const m =
          html.match(new RegExp(`property="${prop}"[^>]*content="([^"]*)"`, 'i')) ||
          html.match(new RegExp(`content="([^"]*)"[^>]*property="${prop}"`, 'i'));
        return m ? unescapeHtml(m[1]) : '';
      };

      title = title || getOG('og:title') || '';
      desc = desc || getOG('og:description') || '';
      img = getOG('og:image') || '';
    } catch (e) {
      // 차단됨 — 기본값 사용
    }
  }

  title = title || 'Facebook 게시물';

  // lookaside 이미지는 카카오 크롤러가 못 읽음 → 프록시
  if (img && img.includes('fbsbx.com')) {
    const host = req.headers.host || '';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const midMatch = img.match(/media_id=(\d+)/);
    if (midMatch) {
      img = `${protocol}://${host}/api/img?mid=${midMatch[1]}`;
    } else {
      img = `${protocol}://${host}/api/img?url=${encodeURIComponent(img)}`;
    }
  }

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
    <p style="margin-bottom:8px;">페이스북으로 이동 중...</p>
    <a href="${escape(url)}" style="color:#1877f2;font-size:14px;">바로가기</a>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.status(200).send(html);
}
