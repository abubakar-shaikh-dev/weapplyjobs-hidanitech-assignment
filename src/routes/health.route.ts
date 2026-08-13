import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { healthHandler } from "../controllers/health.controller.js";

const healthRoutes: FastifyPluginAsyncZod = async function (fastify) {
  fastify.get("/health", healthHandler(fastify));
};

export default healthRoutes;
