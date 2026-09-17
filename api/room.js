const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv({ automaticDeserialization: false });

const TTL = 60 * 60 * 6;

const READ_SCRIPT = `
local s = redis.call('GET', KEYS[1])
local v = redis.call('GET', KEYS[2])
if s == false then s = '' end
if v == false then v = '0' end
return { s, v }
`;

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[2])
if cur == false then cur = '0' end
if ARGV[2] ~= '*' and cur ~= ARGV[2] then
  local s = redis.call('GET', KEYS[1])
  if s == false then s = '' end
  return { '0', cur, s }
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
local nv = tonumber(cur) + 1
redis.call('SET', KEYS[2], tostring(nv), 'EX', tonumber(ARGV[3]))
return { '1', tostring(nv), '' }
`;

function keys(code) {
  const c = String(code || '').toUpperCase();
  return ['room:' + c, 'roomv:' + c];
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const code = (req.query.code || '').toUpperCase();
      if (!code) return res.status(400).json({ error: 'missing code' });

      const [k, kv] = keys(code);
      const out = await redis.eval(READ_SCRIPT, [k, kv], []);
      const raw = out && out[0] ? String(out[0]) : '';
      const version = Number((out && out[1]) || 0);

      if (!raw) return res.status(200).json({ value: null, version: 0 });

      const since = req.query.since;
      if (since !== undefined && since !== '' && Number(since) === version) {
        return res.status(200).json({ notModified: true, version });
      }

      return res.status(200).json({ value: JSON.parse(raw), version });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const { code, state, version } = body || {};
      if (!code || !state) return res.status(400).json({ error: 'missing fields' });

      const [k, kv] = keys(code);
      const expected = version === undefined || version === null ? '*' : String(version);

      const out = await redis.eval(
        CAS_SCRIPT,
        [k, kv],
        [JSON.stringify(state), expected, String(TTL)]
      );

      const okFlag = String(out[0]) === '1';
      const currentVersion = Number(out[1] || 0);

      if (okFlag) return res.status(200).json({ ok: true, version: currentVersion });

      const raw = out[2] ? String(out[2]) : '';
      return res.status(409).json({
        ok: false,
        conflict: true,
        version: currentVersion,
        value: raw ? JSON.parse(raw) : null
      });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
};
