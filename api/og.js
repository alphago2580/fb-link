export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url parameter');

  const escape = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const unescape_html = (s) =>
    String(s || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");

  let title = 'Facebook 게시물';
  let desc = '';
  let img = '';

  try {
    const fbRes = await fetch(url, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    const html = await fbRes.text();

    const getOG = (prop) => {
      const patterns = [
        new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, 'i'),
        new RegExp(`<meta\\s+content="([^"]*)"\s+property="${prop}"`, 'i'),
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) return unescape_html(m[1]);
      }
      return '';
    };

    title = getOG('og:title') || 'Facebook 게시물';
    desc = getOG('og:description') || '';
    img = getOG('og:image') || '';
  } catch (e) {
    // fallback: 기본값 사용
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
