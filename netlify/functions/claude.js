// Server-side proxy for the Anthropic API.
// Keeps your API key OFF the client — the browser only ever talks to this function.
// Key is read from the CLAUDE_API_KEY environment variable (set in Netlify dashboard).

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const key = process.env.CLAUDE_API_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: "CLAUDE_API_KEY is not set in this site's environment variables." }) };
  }
  try {
    const { system, messages } = JSON.parse(event.body || "{}");
    if (!Array.isArray(messages)) {
      return { statusCode: 400, body: JSON.stringify({ error: "messages array required" }) };
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages }),
    });
    const data = await r.json();
    return {
      statusCode: r.status,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
