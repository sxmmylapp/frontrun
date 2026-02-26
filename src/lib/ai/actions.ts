'use server';

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export async function generateResolutionCriteria(
  question: string,
  marketType: 'binary' | 'multiple_choice' = 'binary',
  outcomes?: string[]
): Promise<{ success: true; criteria: string } | { success: false; error: string }> {
  const ts = new Date().toISOString();

  if (!question || question.trim().length < 5) {
    return { success: false, error: 'Question too short' };
  }

  const prompt = marketType === 'multiple_choice' && outcomes?.length
    ? `Write a short resolution rule for this multiple choice prediction market. 1-3 sentences max. Use plain, casual language — no jargon.

The possible outcomes are: ${outcomes.join(', ')}.

Explain how we'll decide which outcome wins. Reference a specific source or method if relevant (e.g., "official results", "final score", "verified announcement"). If there's a scenario where none of the outcomes clearly match, say what happens. Output ONLY the rule, nothing else.

Question: "${question.trim()}"`
    : `Write a short resolution rule for this yes/no bet. 1-2 sentences max. Use plain, casual language — no jargon. Start with "YES if" and keep it dead simple. Just state what needs to happen for YES to win. Output ONLY the rule, nothing else.

Question: "${question.trim()}"`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: prompt,
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
