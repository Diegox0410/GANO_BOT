export default async function handler(request, response) {
  response.setHeader(
    "Access-Control-Allow-Origin",
    "*",
  );

  response.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS",
  );

  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({
      success: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Usa POST para enviar mensajes.",
      },
    });

    return;
  }

  const body =
    typeof request.body === "object" &&
    request.body !== null
      ? request.body
      : {};

  const message =
    typeof body.message === "string"
      ? body.message.trim()
      : "";

  if (!message) {
    response.status(400).json({
      success: false,
      error: {
        code: "INVALID_MESSAGE",
        message:
          "El campo message es obligatorio.",
      },
    });

    return;
  }

  response.status(200).json({
    success: true,
    data: {
      assistantId: "gano-assistant",
      message:
        `GANO_BOT recibió correctamente: "${message}"`,
      mode: "vercel-preview",
      timestamp:
        new Date().toISOString(),
    },
  });
}