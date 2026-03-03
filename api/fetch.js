// /api/fetch.js
// 클라이언트에서 CORS 우회 목적으로 호출
// Facebook URL → { title, img, desc, canonical } 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (!url.includes('facebook.com') && !url.includes('fb.me') && !url.includes('fb.watch')) {
    return res.status(400).json({ error: 'Not a Facebook URL' });
  }

  const unesc = s => String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  const parseOG = html => {
    const m = prop =>
      (html.match(new RegExp(`property="${prop}"[^>]*content="([^"]*)"`, 'i')) ||
       html.match(new RegExp(`content="([^"]*)"[^>]*property="${prop}"`, 'i')))?.[1] || '';
    return {
      title: unesc(m('og:title')),
      img:   unesc(m('og:image')),
      desc:  unesc(m('og:description')),
      canonical: unesc(m('og:url')),
    };
  };

  const isLoginPage = html =>
    /login|checkpoint|로그인\s*또는\s*가입/i.test(html.slice(0, 3000));

  const UAS = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Facebot Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Twitterbot/1.0)',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)',
  ];

  const isSharePUrl = u => /facebook\.com\/share\/(p|v|r)\//.test(u);

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

      // 최종 도착 URL (리다이렉트 후) — share/p/ → canonical URL로 바뀌었을 수 있음
      const finalUrl = r.url || url;
      const resolvedCanonical = (isSharePUrl(url) && !isSharePUrl(finalUrl)) ? finalUrl : null;

      const html = await r.text();

      // OG 데이터 추출
      const og = parseOG(html);

      // canonical URL을 HTML에서도 찾기
      const canonical = resolvedCanonical
        || og.canonical
        || (html.match(/property="og:url"[^>]*content="([^"]*)"/i) || [])[1]
        || '';

      // 로그인 페이지지만 canonical URL은 얻었을 수 있음
      if (isLoginPage(html)) {
        if (resolvedCanonical) {
          // canonical URL만 반환 (OG는 없어도 URL은 건짐)
          return res.status(200).json({ title: '', img: '', desc: '', canonical: resolvedCanonical, ua, resolvedOnly: true });
        }
        continue;
      }

      if (og.title || og.img || canonical) {
        return res.status(200).json({ ...og, canonical, ua });
      }
    } catch(e) {
      continue;
    }
  }

  return res.status(200).json({ title: '', img: '', desc: '', canonical: '', error: 'blocked' });
}
