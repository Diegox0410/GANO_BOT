import {
  getGanoHostedRuntime,
} from "../scripts/gano-hosted-runtime.mjs";

export default async function handler(
  request,
  response,
) {
  try {
    const runtime =
      await getGanoHostedRuntime();

    response
      .status(200)
      .json({
        success: true,

        data: {
          service:
            "GANO_BOT",

          status: "ok",

          environment:
            "vercel",

          tenantId:
            runtime
              .descriptor
              .tenantId,

          assistantId:
            runtime
              .descriptor
              .id,

          knowledgeBaseId:
            runtime
              .knowledgeBase
              .knowledgeBaseId,

          timestamp:
            new Date()
              .toISOString(),
        },
      });
  } catch (error) {
    response
      .status(500)
      .json({
        success: false,

        error: {
          code:
            "HEALTH_ERROR",

          message:
            error instanceof Error
              ? error.message
              : "No se pudo iniciar GANO_BOT.",
        },
      });
  }
}