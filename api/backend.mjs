import {
  getGanoHostedRuntime,
} from "../scripts/gano-hosted-runtime.mjs";

function appendHeader(
  headers,
  name,
  value,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      headers.append(
        name,
        item,
      );
    }

    return;
  }

  if (
    value !== undefined
  ) {
    headers.set(
      name,
      String(value),
    );
  }
}

function resolveBackendPath(
  request,
) {
  const path =
    typeof request.query?.path ===
      "string"
      ? request.query.path
      : "";

  if (!path) {
    return "/";
  }

  return `/v1/${path}`;
}

function resolveBody(
  request,
) {
  if (
    request.method === "GET" ||
    request.method === "HEAD"
  ) {
    return undefined;
  }

  if (
    request.body === undefined ||
    request.body === null
  ) {
    return undefined;
  }

  if (
    typeof request.body ===
    "string"
  ) {
    return request.body;
  }

  if (
    Buffer.isBuffer(
      request.body,
    )
  ) {
    return request.body;
  }

  return JSON.stringify(
    request.body,
  );
}

export default async function handler(
  request,
  response,
) {
  try {
    const runtime =
      await getGanoHostedRuntime();

    const headers =
      new Headers();

    for (
      const [name, value] of
      Object.entries(
        request.headers,
      )
    ) {
      appendHeader(
        headers,
        name,
        value,
      );
    }

    const method =
      request.method ??
      "GET";

    const backendPath =
      resolveBackendPath(
        request,
      );

    const query =
      new URLSearchParams();

    for (
      const [name, value] of
      Object.entries(
        request.query ?? {},
      )
    ) {
      if (name === "path") {
        continue;
      }

      if (
        Array.isArray(value)
      ) {
        for (
          const item of value
        ) {
          query.append(
            name,
            item,
          );
        }
      } else if (
        value !== undefined
      ) {
        query.set(
          name,
          String(value),
        );
      }
    }

    const queryString =
      query.toString();

    const url =
      `https://gano-bot.internal${backendPath}` +
      (
        queryString
          ? `?${queryString}`
          : ""
      );

    const body =
      resolveBody(request);

    const webRequest =
      new Request(
        url,
        {
          method,
          headers,

          ...(
            body === undefined
              ? {}
              : { body }
          ),
        },
      );

    const backendResponse =
      await runtime
        .application
        .handle(
          webRequest,
        );

    response.statusCode =
      backendResponse.status;

    backendResponse
      .headers
      .forEach(
        (
          value,
          name,
        ) => {
          response.setHeader(
            name,
            value,
          );
        },
      );

    const buffer =
      Buffer.from(
        await backendResponse
          .arrayBuffer(),
      );

    response.end(
      buffer,
    );
  } catch (error) {
    console.error(
      "[GANO_BOT Vercel]",
      error,
    );

    response
      .status(500)
      .json({
        success: false,

        error: {
          code:
            "HOSTED_RUNTIME_ERROR",

          message:
            error instanceof Error
              ? error.message
              : "Error interno de GANO_BOT.",
        },
      });
  }
}