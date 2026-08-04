import type { ReactNode } from "react";

export type WidgetState =
  | "closed"
  | "launcher"
  | "minimized"
  | "welcome"
  | "active"
  | "loading"
  | "streaming"
  | "awaiting-confirmation"
  | "error"
  | "offline"
  | "fullscreen";
export type WidgetPosition =
  "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type WidgetTheme = "light" | "dark" | "system" | "custom";
export type WidgetFeedback = "positive" | "negative";
export interface TokenProvider {
  getAccessToken(signal?: AbortSignal): Promise<string | undefined>;
}
export interface WidgetCitation {
  readonly id: string;
  readonly title: string;
  readonly excerpt?: string;
  readonly section?: string;
  readonly page?: number;
  readonly score?: number;
  readonly source?: string;
  readonly documentId?: string;
  readonly url?: string;
  readonly metadata?: Readonly<
    Record<string, string | number | boolean | null>
  >;
}
export interface WidgetToolConfirmation {
  readonly confirmationRequestId: string;
  readonly toolId: string;
  readonly name: string;
  readonly description: string;
  readonly risk: string;
  readonly reason: string;
  readonly expiresAt?: string;
}
export interface WidgetMessage {
  readonly id: string;
  readonly role:
    | "user"
    | "assistant"
    | "system"
    | "tool"
    | "error"
    | "confirmation"
    | "event";
  readonly content: string;
  readonly timestamp: string;
  readonly status: "pending" | "completed" | "failed" | "cancelled";
  readonly citations: readonly WidgetCitation[];
  readonly confirmation?: WidgetToolConfirmation;
  readonly warnings: readonly string[];
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}
export interface WidgetConversation {
  readonly id: string;
  readonly messages: readonly WidgetMessage[];
}
export type WidgetEventType =
  | "open"
  | "close"
  | "minimize"
  | "fullscreen-change"
  | "conversation-created"
  | "message-sent"
  | "message-received"
  | "citation-opened"
  | "tool-confirmation"
  | "error"
  | "ready";
export interface WidgetEvent {
  readonly type: WidgetEventType;
  readonly timestamp: string;
  readonly data?: unknown;
}
export interface WidgetTransportRequest {
  readonly assistantId: string;
  readonly tenantId?: string;
  readonly conversationId?: string;
  readonly message: string;
  readonly locale: string;
  readonly metadata?: Readonly<
    Record<string, string | number | boolean | null>
  >;
  readonly confirmationIds?: readonly string[];
  readonly requestId: string;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}
export interface WidgetTransportResponse {
  readonly conversationId: string;
  readonly message: WidgetMessage;
  readonly citations: readonly WidgetCitation[];
  readonly confirmation?: WidgetToolConfirmation;
}
export type WidgetStreamEventType =
  | "request.accepted"
  | "assistant.resolved"
  | "retrieval.started"
  | "retrieval.completed"
  | "generation.started"
  | "tool.requested"
  | "tool.confirmation-required"
  | "tool.started"
  | "tool.completed"
  | "citation.available"
  | "message.completed"
  | "error"
  | "done";
export interface WidgetStreamEvent {
  readonly type: WidgetStreamEventType;
  readonly timestamp: string;
  readonly data?: unknown;
}
export interface ChatTransport {
  send(request: WidgetTransportRequest): Promise<WidgetTransportResponse>;
  stream?(request: WidgetTransportRequest): AsyncIterable<WidgetStreamEvent>;
  createConversation?(
    request: Omit<WidgetTransportRequest, "message">,
  ): Promise<string>;
  loadConversation?(
    request: Omit<WidgetTransportRequest, "message">,
  ): Promise<WidgetConversation | undefined>;
  deleteConversation?(
    request: Omit<WidgetTransportRequest, "message">,
  ): Promise<void>;
}
export interface StoredWidgetState {
  readonly conversationId?: string;
  readonly state: "closed" | "launcher" | "minimized" | "welcome" | "active";
  readonly theme: WidgetTheme;
  readonly savedAt: string;
}
export interface StorageAdapter {
  load(key: string): Promise<StoredWidgetState | undefined>;
  save(key: string, value: StoredWidgetState): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface AssistantWidgetCallbacks {
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
  readonly onMinimize?: () => void;
  readonly onFullscreenChange?: (fullscreen: boolean) => void;
  readonly onConversationCreated?: (conversationId: string) => void;
  readonly onMessageSent?: (message: WidgetMessage) => void;
  readonly onMessageReceived?: (message: WidgetMessage) => void;
  readonly onCitationOpened?: (citation: WidgetCitation) => void;
  readonly onToolConfirmation?: (
    confirmation: WidgetToolConfirmation,
    confirmed: boolean,
  ) => void;
  readonly onError?: (error: Error) => void;
  readonly onReady?: () => void;
  readonly onFeedback?: (
    messageId: string,
    feedback: WidgetFeedback,
    comment?: string,
  ) => void;
}
export interface AssistantWidgetConfig extends AssistantWidgetCallbacks {
  readonly assistantId: string;
  readonly tenantId?: string;
  readonly apiUrl: string;
  readonly transport?: ChatTransport;
  readonly tokenProvider?: TokenProvider;
  readonly storage?: StorageAdapter;
  readonly initialConversationId?: string;
  readonly locale?: string;
  readonly position?: WidgetPosition;
  readonly zIndex?: number;
  readonly theme?: WidgetTheme;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly logoUrl?: string;
  readonly avatarUrl?: string;
  readonly assistantName?: string;
  readonly welcomeTitle?: string;
  readonly welcomeMessage?: string;
  readonly placeholder?: string;
  readonly suggestedQuestions?: readonly string[];
  readonly compactMode?: boolean;
  readonly fullscreenEnabled?: boolean;
  readonly citationsEnabled?: boolean;
  readonly toolsEnabled?: boolean;
  readonly memoryEnabled?: boolean;
  readonly streamingEnabled?: boolean;
  readonly persistenceEnabled?: boolean;
  readonly autoOpen?: boolean;
  readonly initialState?: WidgetState;
  readonly maximumHeight?: string;
  readonly maximumWidth?: string;
  readonly maximumMessageLength?: number;
  readonly customHeaders?: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<
    Record<string, string | number | boolean | null>
  >;
  readonly footer?: ReactNode;
}
export interface AssistantWidgetProps {
  readonly config: AssistantWidgetConfig;
  readonly className?: string;
}
