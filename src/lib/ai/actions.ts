'use server';

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export async function generateResolutionCriteria(
  question: string
): Promise<{ success: true; criteria: string } | { success: false; error: string }> {
  const ts = new Date().toISOString();

  if (!question || question.trim().length < 5) {
    return { success: false, error: 'Question too short' };
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `You are writing resolution criteria for a prediction market. Given the question below, write clear, objective resolution criteria in 1-3 sentences. Start with "Resolves YES if" and specify the exact conditions, sources, or evidence needed. Be specific about dates, thresholds, and authoritative sources when possible. Output ONLY the criteria text, nothing else.

Question: "${question.trim()}"`,
        },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    if (!text) {
      return { success: false, error: 'Empty response from AI' };
    }

    console.info(`[${ts}] generateResolutionCriteria INFO: generated for "${question.trim().slice(0, 50)}"`);
    return { success: true, criteria: text.trim() };
  } catch (err) {
    console.error(`[${ts}] generateResolutionCriteria ERROR:`, err);
    return { success: false, error: 'Failed to generate criteria' };
  }
}
