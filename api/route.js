// api/route.js — Vercel serverless function to proxy OpenRouteService
// This avoids CORS issues when calling from the browser in production

export default async function handler(req, res) {
  // Allow OPTIONS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'Missing start or end query parameters.' });
  }

  const API_KEY = process.env.ORS_API_KEY || process.env.REACT_APP_API_KEY;
  if (!API_KEY) {
    console.error('No API key found. Set ORS_API_KEY in Vercel environment variables.');
    return res.status(500).json({ error: 'API key not configured on server. Set ORS_API_KEY in Vercel environment variables.' });
  }

  // ORS JWT tokens (eyJ...) must be sent via Authorization header, not query param
  const orsUrl = `https://api.openrouteservice.org/v2/directions/driving-car?start=${start}&end=${end}`;

  try {
    console.log(`Calling ORS: ${orsUrl}`);
    const response = await fetch(orsUrl, {
      headers: {
        'Authorization': API_KEY,
        'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`ORS returned ${response.status}:`, JSON.stringify(data));
      return res.status(response.status).json({
        error: `ORS API error ${response.status}`,
        detail: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Proxy fetch error:', err);
    return res.status(502).json({ error: 'Failed to reach OpenRouteService API.', detail: err.message });
  }
}
