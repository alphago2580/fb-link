export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { url, title, img } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  const id = Math.random().toString(36).slice(2, 8);
  const data = JSON.stringify({ url, title: title || '', img: img || '' });

  const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', `fl:${id}`, data, 'EX', '604800']), // 7일 TTL
  });

  const result = await r.json();
  if (result.result !== 'OK') return res.status(500).json({ error: 'save failed' });

  res.json({ id });
}
