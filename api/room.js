const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const code = (req.query.code || '').toUpperCase();
    if (!code) return res.status(400).json({ error: 'missing code' });
    const data = await redis.get('room:' + code);
    return res.status(200).json({ value: data || null });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { code, state } = body || {};
    if (!code || !state) return res.status(400).json({ error: 'missing fields' });
    // rooms expire after 6 hours so old lessons don't pile up
    await redis.set('room:' + code.toUpperCase(), state, { ex: 60 * 60 * 6 });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
};
