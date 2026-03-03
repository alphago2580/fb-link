export default async function handler(req, res) {
  const { url, title: pTitle, desc: pDesc, img: pImg } = req.query;
  if (!url) return res.status(400).send('Missing url parameter');

  const escape = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const unescapeHtml = (s) =>
    String(s || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");

  let title = pTitle || '';
  let desc = pDesc || '';
  let img = pImg || '';

  // 파라미터 없을 때만 서버 fetch 시도 (클라우드 IP 차단될 수 있음)
  if (!title && !img) {
    try {
      const fbRes = await fetch(url, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });

      const html = await fbRes.text();

      const getOG = (prop) => {
        const m =
          html.match(new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, 'i')) ||
          html.match(new RegExp(`<meta\\s+content="([^"]*)"\s+property="${prop}"`, 'i'));
        return m ? unescapeHtml(m[1]) : '';
      };

      title = getOG('og:title') || '';
      desc = getOG('og:description') || '';
      img = getOG('og:image') || '';
    } catch (e) {
      // 차단됨 — 기본값 사용
    }
  }

  title = title || 'Facebook 게시물';

  // lookaside 이미지는 카카오 크롤러가 못 읽음 → 프록시
  // media_id 숫자만 추출해서 깔끔한 URL 생성 (중첩 인코딩 문제 방지)
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
