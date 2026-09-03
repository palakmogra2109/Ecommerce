export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      process.env.FRONTEND_URL || "http://localhost:5173",

    "Access-Control-Allow-Credentials": "true",

    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",
  };
}