import { Type } from "@google/genai";
import { generateJson } from "./gemini.js";

const schema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER, description: "0-100 overall fit" },
    recommendation: { type: Type.STRING, enum: ["apply", "skip"] },
    matched_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    missing_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    reason: { type: Type.STRING, description: "One or two sentences" },
  },
  required: ["score", "recommendation", "matched_skills", "missing_skills", "reason"],
};

export async function scoreJob(job, profile) {
  const prompt = `You are screening job postings for a candidate. Be strict and honest.
Use ONLY the facts in the candidate profile; never assume skills that are not listed.
Penalize heavily for dealbreakers, a clear seniority/experience mismatch, or an unrelated stack.

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

JOB:
Title: ${job.title}
Company: ${job.company}
Experience required: ${job.experience}
Location: ${job.location}
Description:
${(job.description ?? "").slice(0, 6000)}`;

  return generateJson(prompt, schema);
}
