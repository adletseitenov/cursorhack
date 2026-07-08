// Прокси к OpenRouter: ключ живёт в env Netlify, в браузер и git не попадает.
export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return Response.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  // белый список полей — через наш ключ ходят только запросы нашего формата
  const payload = {
    model: String(body.model || ""),
    messages: body.messages,
    max_tokens: Math.min(Number(body.max_tokens) || 150, 300),
  };
  if (body.response_format) payload.response_format = body.response_format;
  if (!payload.model || !Array.isArray(payload.messages)) {
    return Response.json({ error: "model and messages required" }, { status: 400 });
  }
  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(9000), // лимит функции на Free-плане — 10 c
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return Response.json({ error: "upstream: " + e.message }, { status: 504 });
  }
};

export const config = { path: "/api/vlm" };
