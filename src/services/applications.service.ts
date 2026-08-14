import type { PrismaClient } from "../generated/prisma/client.js";
import type { CreateApplicationBody } from "../validations/applications.validation.js";

export interface ApplicationRecord {
  id: string;
  jobId: string;
  candidateId: string;
  recruiterId: string;
  coverLetter: string;
  createdAt: string;
}

export async function createApplication(
  db: PrismaClient,
  input: CreateApplicationBody,
): Promise<ApplicationRecord> {
  const application = await db.application.create({
    data: input,
  });

  return {
    id: application.id,
    jobId: application.jobId,
    candidateId: application.candidateId,
    recruiterId: application.recruiterId,
    coverLetter: application.coverLetter,
    createdAt: application.createdAt.toISOString(),
  };
}
