import type { AIUnknownRecord } from "@gano-bot/ai-core";
import type {
  ToolDefinition,
  ToolExecutionContext,
} from "@gano-bot/ai-core/tools-engine";

export interface GanoSimAffiliateProfile {
  readonly affiliateId: string;
  readonly displayName: string;
  readonly currentRank: string;
  readonly personalVolume: number;
  readonly nextRank: string;
}

export interface GanoSimAffiliateProfileProvider {
  getCurrentProfile(
    tenantId: string,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<GanoSimAffiliateProfile | undefined>;
}

export function createGanoSimAffiliateProfileTool(
  provider: GanoSimAffiliateProfileProvider,
  tenantId: string,
  assistantId: string,
): ToolDefinition {
  return Object.freeze({
    descriptor: Object.freeze({
      id: "gano.getCurrentAffiliateProfile",
      name: "gano.getCurrentAffiliateProfile",
      description:
        "Obtiene exclusivamente el perfil del afiliado autenticado en la solicitud actual.",
      version: "1.0.0",
      category: "business",
      riskLevel: "safe",
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({}),
      }),
      outputSchema: Object.freeze({ type: "object" }),
      requiredPermissions: Object.freeze(["tools:execute"]),
      confirmationPolicy: "never",
      timeoutMs: 2_000,
      enabled: true,
      tenantId,
      assistantId,
      tags: Object.freeze(["gano-sim", "affiliate", "private"]),
    }),
    handler: Object.freeze({
      async execute(
        _argumentsValue: AIUnknownRecord,
        context: ToolExecutionContext,
      ) {
        const profile = await provider.getCurrentProfile(
          context.tenantId,
          context.actorId,
          context.signal,
        );
        return profile === undefined
          ? Object.freeze({
              authenticated: false,
              message:
                "Inicia sesión como afiliado para consultar progreso o datos personales.",
            })
          : Object.freeze({ authenticated: true, profile });
      },
    }),
  });
}

/** Adaptador volátil para desarrollo local; producción debe inyectar un repositorio autorizado. */
export class DevelopmentGanoSimAffiliateProfileProvider
  implements GanoSimAffiliateProfileProvider
{
  public constructor(
    private readonly profiles: Readonly<Record<string, GanoSimAffiliateProfile>>,
  ) {}

  public async getCurrentProfile(
    tenantId: string,
    actorId: string,
  ): Promise<GanoSimAffiliateProfile | undefined> {
    return this.profiles[`${tenantId}:${actorId}`];
  }
}
