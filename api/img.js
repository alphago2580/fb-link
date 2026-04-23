const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// SSRF 방지: 사설/루프백 주소 차단, 공개 http(s) 이미지는 모두 허용
function isSafeImgUrl(rawUrl) {
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

  if (!isSafeImgUrl(targetUrl)) {
    return res.status(400).send('Invalid url');
  }

  try {
    const isFbCdn = /(^|\.)fb(sbx|cdn)\.(com|net)$|(^|\.)cdninstagram\.com$/.test(new URL(targetUrl).hostname);
    const imgRes = await fetch(targetUrl, {
      headers: isFbCdn ? {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Referer': 'https://www.facebook.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      } : {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
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
