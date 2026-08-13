import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default("http://localhost:8000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  console.error(
    [
      "",
      "Invalid environment configuration:",
      "",
      details,
      "",
      "Fix: copy .env.example to .env, fill in the required values, then restart.",
      "",
    ].join("\n"),
  );

  process.exit(1);
}

export const env = Object.freeze(parsed.data);

export type Env = typeof env;
