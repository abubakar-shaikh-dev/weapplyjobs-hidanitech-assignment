import fp from "fastify-plugin";
import type { FastifyError } from "fastify";

interface ValidationErrorDetails {
  field: string;
  message: string;
}

function formatValidationDetails(error: FastifyError): ValidationErrorDetails[] {
  return (error.validation ?? []).map((issue) => {
    const path = String(issue.instancePath ?? "").replace(/^\//, "").replaceAll("/", ".");

    return {
      field: path,
      message: issue.message ?? "Invalid value",
    };
  });
}

export default fp(
  async function errorHandlerPlugin(fastify) {
    fastify.setErrorHandler(async (error: FastifyError, request, reply) => {
      if (error.validation) {
        const details = formatValidationDetails(error);

        request.log.warn({ err: error }, "Request validation failed");

        reply.status(400);
        return {
          statusCode: 400,
          error: "Bad Request",
          message: details.map((d) => `${d.field}: ${d.message}`).join("; "),
          details,
        };
      }

      if (error.statusCode && error.statusCode < 500) {
        reply.status(error.statusCode);
        return {
          statusCode: error.statusCode,
          error: error.name ?? "Error",
          message: error.message,
        };
      }

      request.log.error(error);
      reply.status(500);
      return {
        statusCode: 500,
        error: "Internal Server Error",
        message: "An unexpected error occurred",
      };
    });

    fastify.setNotFoundHandler(async (request, reply) => {
      reply.status(404);
      return {
        statusCode: 404,
        error: "Not Found",
        message: `Route ${request.method} ${request.url} not found`,
      };
    });
  },
  {
    name: "error-handler-plugin",
  },
);
