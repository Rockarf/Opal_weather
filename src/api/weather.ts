export const config = { runtime: 'edge' };

type GeoItem = {
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
};
type GeoResult = { results?: GeoItem[] };

type WeatherCurrent = {
  temperature: number;
  windspeed: number;
  weathercode: number;
  time: string; // ISO
};
type WeatherResult = { current_weather?: WeatherCurrent };

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const { searchParams } = new URL(req.url);
  const city = (searchParams.get('city') || '').trim();
  const country = (searchParams.get('country') || '').trim();
  const units = (searchParams.get('units') || 'metric').toLowerCase();

  if (!city) {
    return json({ error: "Missing required query param 'city'." }, 400);
  }

  const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
  const windUnit = units === 'imperial' ? 'mph' : 'kmh';

  // 1) Geocode
  const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geoUrl.searchParams.set('name', city);
  geoUrl.searchParams.set('count', '1');
  if (country) geoUrl.searchParams.set('country', country);

  const geoRes = await fetch(geoUrl.toString(), { cache: 'no-store' });
  if (!geoRes.ok) return json({ error: 'Geocoding failed.' }, 502);

  const geo = (await geoRes.json()) as GeoResult;
  if (!geo.results?.length) return json({ error: 'City not found.' }, 404);

  const g = geo.results[0];
  const lat = g.latitude;
  const lon = g.longitude;

  // 2) Weather
  const wxUrl = new URL('https://api.open-meteo.com/v1/forecast');
  wxUrl.searchParams.set('latitude', String(lat));
  wxUrl.searchParams.set('longitude', String(lon));
  wxUrl.searchParams.set('current_weather', 'true');
  wxUrl.searchParams.set('temperature_unit', tempUnit);
  wxUrl.searchParams.set('wind_speed_unit', windUnit);

  const wxRes = await fetch(wxUrl.toString(), {
    headers: { 'User-Agent': 'opal-weather-vercel/1.0' },
    next: { revalidate: 600 } // 10 min edge cache
  });
  if (!wxRes.ok) return json({ error: 'Weather fetch failed.' }, 502);

  const wx = (await wxRes.json()) as WeatherResult;
  if (!wx.current_weather) return json({ error: 'No current weather data.' }, 502);

  const payload = {
    city: g.name,
    country: g.country_code || country || null,
    coordinates: { lat, lon },
    temperature: wx.current_weather.temperature,
    temperatureUnit: tempUnit,
    windSpeed: wx.current_weather.windspeed,
    windSpeedUnit: windUnit,
    weatherCode: wx.current_weather.weathercode,
    observedAt: wx.current_weather.time,
    source: 'open-meteo'
  };

  return json(payload, 200, {
    'Cache-Control': 'public, s-maxage=600, max-age=60'
  });
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders
    }
  });
}
