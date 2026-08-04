import { KnowledgeError, throwIfKnowledgeAborted } from "./errors.js";
import { createKnowledgeChunk } from "./chunks.js";

import type { KnowledgeChunk } from "./chunks.js";
import type { ParsedDocument } from "./parser.js";
import type { KnowledgeOperationContext } from "./types.js";

export type ChunkingStrategyKind =
  | "fixed-size" | "paragraph" | "sentence" | "markdown" | "heading"
  | "semantic" | "sliding-window" | "token-based";

export interface ChunkingRequest {
  readonly document: ParsedDocument;
  readonly context: KnowledgeOperationContext;
}

export interface ChunkingResult {
  readonly chunks: readonly KnowledgeChunk[];
  readonly strategyId: string;
  readonly deterministic: boolean;
  readonly warnings: readonly string[];
}

export interface ChunkingStrategy {
  readonly id: string;
  readonly kind: ChunkingStrategyKind;
  readonly deterministic: boolean;
  chunk(request: ChunkingRequest): Promise<ChunkingResult>;
}

export interface SemanticChunkingStrategy extends ChunkingStrategy { readonly kind: "semantic"; }
export interface TokenBasedChunkingStrategy extends ChunkingStrategy { readonly kind: "token-based"; }

interface TextRange { readonly text: string; readonly start: number; readonly end: number; readonly heading?: string; }

function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function createResult(strategy: ChunkingStrategy, request: ChunkingRequest, ranges: readonly TextRange[]): ChunkingResult {
  const document = request.document;
  const chunks = ranges
    .filter((range) => range.text.trim().length > 0)
    .map((range, index) => createKnowledgeChunk({
      identity: document,
      content: range.text,
      index,
      startOffset: range.start,
      endOffset: range.end,
      language: document.language,
      ...(range.heading !== undefined ? { heading: range.heading, section: range.heading } : {}),
    }));
  return Object.freeze({ chunks: Object.freeze(chunks), strategyId: strategy.id, deterministic: strategy.deterministic, warnings: Object.freeze([]) });
}

function splitByPattern(text: string, pattern: RegExp): readonly TextRange[] {
  const ranges: TextRange[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const index = match.index;
    if (value === undefined || index === undefined) continue;
    const start = cursor;
    const end = index + value.length;
    ranges.push({ text: text.slice(start, end), start, end });
    cursor = end;
  }
  if (cursor < text.length) ranges.push({ text: text.slice(cursor), start: cursor, end: text.length });
  return Object.freeze(ranges);
}

function createFunctionalStrategy(
  id: string,
  kind: ChunkingStrategyKind,
  split: (text: string) => readonly TextRange[],
): ChunkingStrategy {
  const strategy: ChunkingStrategy = Object.freeze({
    id,
    kind,
    deterministic: true,
    async chunk(request: ChunkingRequest): Promise<ChunkingResult> {
      throwIfKnowledgeAborted(request.context.signal);
      return createResult(strategy, request, split(request.document.text));
    },
  });
  return strategy;
}

export function createFixedSizeChunkingStrategy(config: { readonly size?: number; readonly overlap?: number } = {}): ChunkingStrategy {
  const size = normalizePositive(config.size, 1_500);
  const overlap = Math.min(normalizePositive(config.overlap, 150), size - 1);
  return createFunctionalStrategy(`fixed-${size}-${overlap}`, "fixed-size", (text) => {
    const ranges: TextRange[] = [];
    const step = size - overlap;
    for (let start = 0; start < text.length; start += step) {
      const end = Math.min(start + size, text.length);
      ranges.push({ text: text.slice(start, end), start, end });
      if (end === text.length) break;
    }
    return ranges;
  });
}

export function createSlidingWindowChunkingStrategy(config: { readonly windowSize?: number; readonly stepSize?: number } = {}): ChunkingStrategy {
  const windowSize = normalizePositive(config.windowSize, 1_500);
  const stepSize = normalizePositive(config.stepSize, 1_000);
  if (stepSize > windowSize) throw new KnowledgeError("INVALID_CONFIGURATION", "stepSize no puede superar windowSize.");
  return createFunctionalStrategy(`sliding-${windowSize}-${stepSize}`, "sliding-window", (text) => {
    const ranges: TextRange[] = [];
    for (let start = 0; start < text.length; start += stepSize) {
      const end = Math.min(start + windowSize, text.length);
      ranges.push({ text: text.slice(start, end), start, end });
      if (end === text.length) break;
    }
    return ranges;
  });
}

export function createParagraphChunkingStrategy(): ChunkingStrategy {
  return createFunctionalStrategy("paragraph", "paragraph", (text) => splitByPattern(text, /(?:\r?\n){2,}/g));
}

export function createSentenceChunkingStrategy(): ChunkingStrategy {
  return createFunctionalStrategy("sentence", "sentence", (text) => splitByPattern(text, /[^.!?\n]+[.!?]+(?:\s+|$)/g));
}

function splitMarkdown(text: string): readonly TextRange[] {
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  const headings = [...text.matchAll(headingPattern)];
  if (headings.length === 0) return [{ text, start: 0, end: text.length }];
  const ranges: TextRange[] = [];
  if ((headings[0]?.index ?? 0) > 0) ranges.push({ text: text.slice(0, headings[0]?.index), start: 0, end: headings[0]?.index ?? 0 });
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    if (match === undefined || match.index === undefined) continue;
    const end = headings[index + 1]?.index ?? text.length;
    ranges.push({ text: text.slice(match.index, end), start: match.index, end, heading: match[2]?.trim() });
  }
  return ranges;
}

export function createMarkdownChunkingStrategy(): ChunkingStrategy {
  return createFunctionalStrategy("markdown", "markdown", splitMarkdown);
}

export function createHeadingChunkingStrategy(): ChunkingStrategy {
  return createFunctionalStrategy("heading", "heading", splitMarkdown);
}
