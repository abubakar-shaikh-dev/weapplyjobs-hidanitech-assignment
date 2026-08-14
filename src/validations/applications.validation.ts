import { z } from "zod";

export const createApplicationBodySchema = z.object({
  jobId: z
    .string({ error: "jobId is required and must be a string" })
    .min(1, "jobId must not be empty"),
  candidateId: z
    .string({ error: "candidateId is required and must be a string" })
    .min(1, "candidateId must not be empty"),
  recruiterId: z
    .string({ error: "recruiterId is required and must be a string" })
    .min(1, "recruiterId must not be empty"),
  coverLetter: z
    .string({ error: "coverLetter is required and must be a string" })
    .min(1, "coverLetter must not be empty"),
});

export type CreateApplicationBody = z.infer<typeof createApplicationBodySchema>;

export const applicationResponseSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string(),
  candidateId: z.string(),
  recruiterId: z.string(),
  coverLetter: z.string(),
  createdAt: z.string(),
});

export type ApplicationResponse = z.infer<typeof applicationResponseSchema>;
