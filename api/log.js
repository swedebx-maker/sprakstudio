const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv({ automaticDeserialization: false });

const LOG_KEY = 'sprakstudio:log';
const MAX_LINES = 20000;

const EVENTS = {
  room_created:   { discord: true,  text: d => `startat rum ${d.code} i ${d.ip} ip.` },
  game_started:   { discord: true,  text: d => `spelet startat i rum ${d.code} (${d.players} elever, ${d.rounds} rundor) i ${d.ip} ip.` },
  player_joined:  { discord: false, text: d => `elev gick med i rum ${d.code} i ${d.ip} ip.` },
  game_finished:  { discord: true,  text: d => `spelet slut i rum ${d.code} (${d.players} elever, ${d.rounds} rundor) i ${d.ip} ip.` },
  room_cancelled: { discord: true,  text: d => `rum ${d.code} avbrutet i ${d.ip} ip.` }
};

function stamp() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function maskIp(ip) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.x');
  if (ip.includes(':')) {
    const v4 = ip.match(/(\d{1,3}(\.\d{1,3}){3})$/);
    if (v4) return maskIp(v4[1]);
    return ip.split(':').filter(Boolean).slice(0, 3).join(':') + ':x';
  }
  return 'okänd';
}

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = (xff || String(req.headers['x-real-ip'] || '')).replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45);
  return ip ? maskIp(ip) : 'okänd';
}

const int = v => Math.max(0, Math.min(999, parseInt(v, 10) || 0));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      if (!process.env.LOG_KEY || req.query.key !== process.env.LOG_KEY) return res.status(401).send('nej');
      const lines = await redis.lrange(LOG_KEY, 0, -1);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (req.query.download) res.setHeader('Content-Disposition', 'attachment; filename="sprakstudio-log.txt"');
      return res.status(200).send((lines || []).join('\n') + '\n');
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '{}');
      const ev = EVENTS[body && body.event];
      if (!ev) return res.status(400).json({ error: 'bad event' });

      const code = String(body.code || '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return res.status(400).json({ error: 'bad code' });

      const line = `${stamp()}: ${ev.text({
        code, ip: clientIp(req), players: int(body.players), rounds: int(body.rounds)
      })}`;

      await redis.rpush(LOG_KEY, line);
      await redis.ltrim(LOG_KEY, -MAX_LINES, -1);

      const hook = process.env.DISCORD_WEBHOOK_URL;
      if (hook && ev.discord) {
        try {
          await fetch(hook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'SpråkStudio', content: line, allowed_mentions: { parse: [] } })
          });
        } catch (e) {}
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
