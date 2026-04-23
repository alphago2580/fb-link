export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).end();

  // Redis에서 데이터 조회
  const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['GET', `fl:${id}`]),
  });

  const result = await r.json();
  if (!result.result) return res.status(404).send('링크를 찾을 수 없어요 (만료됐거나 잘못된 링크)');

  let { url, title, img, desc } = JSON.parse(result.result);

  const host = req.headers.host || '';
  const proto = host.includes('localhost') ? 'http' : 'https';
  // fbcdn/fbsbx 이미지 → 프록시 (만료 토큰·크롤러 차단 우회)
  if (img && img.includes('fbsbx.com')) {
    const mid = img.match(/media_id=(\d+)/);
    img = mid
      ? `${proto}://${host}/api/img?mid=${mid[1]}`
      : `${proto}://${host}/api/img?url=${encodeURIComponent(img)}`;
  } else if (img && img.includes('fbcdn.net')) {
    img = `${proto}://${host}/api/img?url=${encodeURIComponent(img)}`;
  }

  title = title || '링크 미리보기';
  desc = desc || '';

  const escape = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${escape(title)}</title>
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(desc)}">
  <meta property="og:image" content="${escape(img)}">
  <meta property="og:url" content="${escape(url)}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:description" content="${escape(desc)}">
  <meta name="twitter:image" content="${escape(img)}">
  <meta http-equiv="refresh" content="0;url=${escape(url)}">
</head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f0f2f5;margin:0;">
  <div style="text-align:center;color:#666;">
    <p>원문 페이지로 이동 중...</p>
    <a href="${escape(url)}" style="color:#1877f2;font-size:14px;">바로가기</a>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.status(200).send(html);
}
