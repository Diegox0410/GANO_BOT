export default async function handler(
  request,
  response,
) {
  response
    .status(200)
    .json({
      success: true,
      data: {
        service: "GANO_BOT",
        status: "ok",
        environment: "vercel",
        runtime: "node",
        timestamp:
          new Date().toISOString(),
      },
    });
}