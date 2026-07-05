export default {
  async fetch(request, env) {
    const allowedOrigin =
      `chrome-extension://${env.EXTENSION_ID}`;
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }
    const origin = request.headers.get("Origin");
    if (origin !== allowedOrigin) {
      return new Response(
        JSON.stringify({
          error: "Forbidden origin"
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      url.pathname !== "/auth/github/exchange"
    ) {
      return new Response(
        JSON.stringify({
          error: "Not found"
        }),
        {
          status: 404,
          headers: corsHeaders
        }
      );
    }
    const ip =
      request.headers.get("CF-Connecting-IP")
      ?? "unknown";
    const { success } =
      await env.RATE_LIMITER.limit({
        key: ip
      });
    if (!success) {
      return new Response(
        JSON.stringify({
          error: "Too many requests"
        }),
        {
          status: 429,
          headers: corsHeaders
        }
      );
    }
    let code;
    let code_verifier;
    try {
      const body = await request.json();
      code = body.code;
      code_verifier = body.code_verifier;
    } catch {
      return new Response(
        JSON.stringify({
          error: "Invalid request body"
        }),
        {
          status: 400,
          headers: corsHeaders
        }
      );
    }
    if (!code || !code_verifier) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields"
        }),
        {
          status: 400,
          headers: corsHeaders
        }
      );
    }
    const githubBody = {
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      code_verifier,
      redirect_uri: env.GITHUB_REDIRECT_URI
    };
    let tokenData;
    try {
      const res = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body:
            JSON.stringify(githubBody)
        }
      );
      tokenData = await res.json();
    } catch {
      return new Response(
        JSON.stringify({
          error: "GitHub unreachable"
        }),
        {
          status: 502,
          headers: corsHeaders
        }
      );
    }
    if (tokenData.error) {
      const status =
        tokenData.error === "bad_verification_code"
          ? 400
          : 502;
      return new Response(
        JSON.stringify({
          error:
            tokenData.error_description
            ?? tokenData.error
        }),
        {
          status,
          headers: corsHeaders
        }
      );
    }
    if (!tokenData.access_token) {
      return new Response(
        JSON.stringify({
          error: "No token returned"
        }),
        {
          status: 502,
          headers: corsHeaders
        }
      );
    }
    return new Response(
      JSON.stringify({
        access_token:
          tokenData.access_token
      }),
      {
        status: 200,
        headers: corsHeaders
      }
    );
  }
};