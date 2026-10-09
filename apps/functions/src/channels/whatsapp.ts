import { safeCatalogImageUrl } from "../commerce/catalogTools.js";

export type CommercialChannelMessage =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly url: string; readonly caption?: string; readonly alt?: string };

export interface CommercialChannelContext {
  readonly tenantId: string;
  readonly recipient: string;
  readonly correlationId: string;
}

export interface CommercialChannelTransport {
  send(context: CommercialChannelContext, message: CommercialChannelMessage): Promise<{ readonly messageId: string }>;
}

export interface CommercialChannel {
  sendText(context: CommercialChannelContext, text: string): Promise<{ readonly messageId: string }>;
  sendImage(context: CommercialChannelContext, url: string): Promise<{ readonly messageId: string }>;
  sendImageWithCaption(context: CommercialChannelContext, url: string, caption: string): Promise<{ readonly messageId: string }>;
}

/** The transport owns Meta credentials/API version. Commercial logic uses this channel port. */
export class WhatsAppChannelAdapter implements CommercialChannel {
  public constructor(private readonly tenantId: string, private readonly transport: CommercialChannelTransport) {}

  private validateContext(context: CommercialChannelContext): void {
    if (context.tenantId !== this.tenantId || !/^\d{8,15}$/.test(context.recipient) || !context.correlationId.trim()) throw new Error("Invalid WhatsApp channel scope.");
  }

  public sendText(context: CommercialChannelContext, value: string): Promise<{ readonly messageId: string }> {
    this.validateContext(context);
    const text = value.trim();
    if (!text || text.length > 4096) throw new Error("Invalid WhatsApp text.");
    return this.transport.send(context, Object.freeze({ type: "text", text }));
  }

  public sendImage(context: CommercialChannelContext, value: string): Promise<{ readonly messageId: string }> {
    this.validateContext(context);
    const url = safeCatalogImageUrl(value);
    if (!url) throw new Error("WhatsApp images require a public HTTPS URL.");
    return this.transport.send(context, Object.freeze({ type: "image", url }));
  }

  public sendImageWithCaption(context: CommercialChannelContext, value: string, caption: string): Promise<{ readonly messageId: string }> {
    this.validateContext(context);
    const url = safeCatalogImageUrl(value);
    if (!url || !caption.trim() || caption.length > 1024) throw new Error("Invalid WhatsApp image caption.");
    return this.transport.send(context, Object.freeze({ type: "image", url, caption: caption.trim() }));
  }
}
