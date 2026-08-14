import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  applicationResponseSchema,
  createApplicationBodySchema,
} from "../validations/applications.validation.js";
import { createApplicationHandler } from "../controllers/applications.controller.js";

const applicationsRoutes: FastifyPluginAsyncZod = async function (fastify) {
  fastify.post(
    "/api/applications",
    {
      schema: {
        body: createApplicationBodySchema,
        response: {
          201: applicationResponseSchema,
        },
      },
    },
    createApplicationHandler(fastify),
  );
};

export default applicationsRoutes;
