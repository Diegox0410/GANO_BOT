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

export * from "./base.js";

/* ============================================================================
 * OPENAI
 * ========================================================================== */

export * from "./openai.js";

/* ============================================================================
 * GOOGLE GEMINI
 * ========================================================================== */

export * from "./base.js";
export * from "./openai.js";
export * from "./gemini.js";
export * from "./registry.js";
export * from "./fallback.js";