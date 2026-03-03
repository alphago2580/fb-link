export default async function handler(req, res) {
  const { url, mid } = req.query;
  // mid: media_id 숫자만 받은 경우 (중첩 인코딩 방지용)
  const targetUrl = url || (mid ? `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${mid}` : null);
  if (!targetUrl) return res.status(400).send('Missing url or mid');

  try {
    const imgRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Referer': 'https://www.facebook.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!imgRes.ok) return res.status(imgRes.status).send('Image fetch failed');

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await imgRes.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
}
