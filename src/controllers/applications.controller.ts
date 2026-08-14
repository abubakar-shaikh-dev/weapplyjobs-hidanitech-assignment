import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CreateApplicationBody } from "../validations/applications.validation.js";
import { createApplication } from "../services/applications.service.js";
import { enqueueApplicationCreatedJobs } from "../services/queues.service.js";

export function createApplicationHandler(fastify: FastifyInstance) {
  return async function handler(
    request: FastifyRequest<{ Body: CreateApplicationBody }>,
    reply: FastifyReply,
  ) {
    const application = await createApplication(fastify.db, request.body);
    await enqueueApplicationCreatedJobs(fastify.queues, application);

    reply.status(201);
    return application;
  };
}
