import { runScheduled, type Env } from "../../../cloudflare/src/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const expectedSecret = Deno.env.get("SCANNER_RUN_SECRET");
  const authorization = request.headers.get("authorization") || "";
  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ status: "UNAUTHORIZED" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const env: Env = {
    TWELVE_DATA_API_KEY: Deno.env.get("TWELVE_DATA_API_KEY") || "",
    SUPABASE_URL: Deno.env.get("SUPABASE_URL") || "",
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    SCANNER_ENABLED: Deno.env.get("SCANNER_ENABLED") || "false",
    SCANNER_RUN_SECRET: expectedSecret,
    WATCHLIST: Deno.env.get("WATCHLIST"),
  };

  try {
    const result = await runScheduled(env, new Date());
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("macsignaltrades_scanner_failed", String(error));
    return new Response(JSON.stringify({ status: "ERROR", error: String(error) }), {
      status: 503,
      headers: corsHeaders,
    });
  }
});
