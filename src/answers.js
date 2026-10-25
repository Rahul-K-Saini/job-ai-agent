import { Type } from "@google/genai";
import { generateJson } from "./gemini.js";

const schema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING, description: "The answer to give, or empty string if unknown" },
    needs_human: { type: Type.BOOLEAN, description: "true if the facts do not clearly cover this question" },
    reason: { type: Type.STRING, description: "One short sentence" },
  },
  required: ["answer", "needs_human", "reason"],
};

export async function answerQuestion({ question, options }, facts, job) {
  const prompt = `You answer job-application screening questions on behalf of a candidate.
Rules:
- Use ONLY the facts below. Empty values mean UNKNOWN.
- If the facts do not clearly cover the question, set needs_human=true and answer="".
- Never invent numbers, dates, salaries or experience. Never claim skills that are not in the facts.
- If OPTIONS are given, "answer" must be exactly one of them (copy the text exactly).
- Otherwise answer briefly and directly (a number, yes/no, or a short phrase).

CANDIDATE FACTS:
${JSON.stringify(facts, null, 2)}

JOB: ${job.title} at ${job.company}

QUESTION: ${question}
OPTIONS: ${options.length ? JSON.stringify(options) : "none (free text)"}`;

  return generateJson(prompt, schema);
}
