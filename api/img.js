// 허용 도메인 (SSRF 방지)
const ALLOWED_IMG_HOSTS = [
  'fbsbx.com', 'lookaside.fbsbx.com',
  'scontent.fbcdn.net', 'fbcdn.net',
  'cdninstagram.com', 'scontent.cdninstagram.com',
  'external.fbcdn.net',
];

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function isAllowedImgUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_IMG_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const { url, mid } = req.query;

  // mid: 숫자만 허용 (파라미터 인젝션 방지)
  if (mid !== undefined && !/^\d+$/.test(mid)) {
    return res.status(400).send('Invalid mid parameter');
  }

  const targetUrl = mid
    ? `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${mid}`
    : url || null;

  if (!targetUrl) return res.status(400).send('Missing url or mid');

  // SSRF 방지: 허용된 Facebook CDN 도메인만 fetch
  if (!isAllowedImgUrl(targetUrl)) {
    return res.status(400).send('Invalid url: only Facebook CDN URLs are allowed');
  }

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

    // Content-Type 허용 목록 검사 (Content-Type 주입 방지)
    const rawContentType = imgRes.headers.get('content-type') || '';
    const contentType = ALLOWED_CONTENT_TYPES.find(t => rawContentType.startsWith(t)) || 'image/jpeg';

    // 응답 크기 제한 (메모리 고갈 방지)
    const contentLength = parseInt(imgRes.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_SIZE) {
      return res.status(413).send('Image too large');
    }

    const buffer = await imgRes.arrayBuffer();
    if (buffer.byteLength > MAX_SIZE) {
      return res.status(413).send('Image too large');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (e) {
    // 에러 메시지 내부 정보 노출 방지
    res.status(500).send('Image fetch failed');
  }
}
