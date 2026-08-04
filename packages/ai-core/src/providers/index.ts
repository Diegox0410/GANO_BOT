/**
 * @package @gano-bot/ai-core
 * @file providers/index.ts
 * @version 1.0.1
 *
 * Punto central de exportación de los proveedores de IA.
 *
 * Reúne:
 * - Infraestructura base de proveedores.
 * - Proveedor de embeddings de OpenAI.
 * - Proveedor de embeddings de Google Gemini.
 */

/* ============================================================================
 * INFRAESTRUCTURA BASE
 * ========================================================================== */

export * from "./base";

/* ============================================================================
 * OPENAI
 * ========================================================================== */

export * from "./openai";

/* ============================================================================
 * GOOGLE GEMINI
 * ========================================================================== */

export * from "./base";
export * from "./openai";
export * from "./gemini";
export * from "./registry";
export * from "./fallback";