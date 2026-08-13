import fp from "fastify-plugin";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

export default fp(
  async function zodPlugin(fastify) {
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);
  },
  {
    name: "zod-plugin",
  },
);
