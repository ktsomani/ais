import { getEncoding, type Tiktoken } from 'js-tiktoken';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = getEncoding('o200k_base');
  }
  return encoder;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}

export function truncateToTokens(text: string, maxTokens: number, suffix = '…'): string {
  if (maxTokens <= 0) return '';
  const enc = getEncoder();
  const tokens = enc.encode(text);
  if (tokens.length <= maxTokens) return text;

  const suffixTokens = enc.encode(suffix).length;
  const keep = Math.max(0, maxTokens - suffixTokens);
  if (keep === 0) return '';
  return enc.decode(tokens.slice(0, keep)).trimEnd() + suffix;
}