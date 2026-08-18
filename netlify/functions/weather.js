// Server-side proxy for Open-Meteo (free, no key required, but proxied so the
// client stays simple and CORS is never an issue). Geocodes the location name,
// pulls the real historical hourly weather for that date, and returns the
// daylight-window samples the drift engine needs.

exports.handler = async (event) => {
  const { location, date } = event.queryStringParameters || {};
  if (!location || !date) {
    return { statusCode: 400, body: JSON.stringify({ error: "location and date are required" }) };
  }
  try {
    const g = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`
    );
    const gj = await g.json();
    if (!gj.results || !gj.results[0]) {
      return { statusCode: 404, body: JSON.stringify({ error: "location not found" }) };
    }
    const { latitude, longitude, name } = gj.results[0];
    const u =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}` +
      `&start_date=${date}&end_date=${date}` +
      `&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
    const r = await fetch(u);
    const j = await r.json();
    const h = j.hourly;
    if (!h || !h.time) {
      return { statusCode: 502, body: JSON.stringify({ error: "no weather data for that date/location" }) };
    }
    // keep daylight hours (05:00–19:00) — a coarse sit window until start/end times are captured
    const wx = h.time
      .map((t, i) => ({
        hr: +t.slice(11, 13),
        dir: h.wind_direction_10m[i],
        spd: h.wind_speed_10m[i],
        pres: h.surface_pressure[i],
        temp: h.temperature_2m[i],
      }))
      .filter((p) => p.hr >= 5 && p.hr <= 19)
      .map(({ dir, spd, pres, temp }) => ({ dir, spd, pres, temp }));
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wx, place: name }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
