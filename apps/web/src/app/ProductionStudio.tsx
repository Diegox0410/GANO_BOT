import { useEffect, useMemo, useState } from "react";
import { HttpChatTransport } from "@gano-bot/chat-widget";
import { StudioApp } from "../features/studio/StudioApp";
import type { StudioPermission, StudioPrincipal } from "../features/studio/domain";
import { BackendAssistantStudioService } from "../features/studio/service";

const STUDIO_PERMISSIONS: readonly StudioPermission[] = Object.freeze([
  "assistants:read",
  "assistants:write",
  "assistants:publish",
  "knowledge:read",
  "knowledge:write",
  "tools:read",
  "tools:configure",
  "metrics:read",
]);

interface FirebaseSession {
  readonly idToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly principal: StudioPrincipal;
  readonly email: string;
}

interface FirebaseSignInResponse {
  readonly idToken?: string;
  readonly refreshToken?: string;
  readonly expiresIn?: string;
  readonly email?: string;
}

interface FirebaseRefreshResponse {
  readonly id_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: string;
}

const SESSION_KEY = "ganobot.firebase.session.v1";

function requiredEnv(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Configuración de producción incompleta: ${name}.`);
  return normalized;
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  return configured ? configured.replace(/\/$/, "") : window.location.origin;
}

function decodeJwtPayload(token: string): Readonly<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("Firebase devolvió un token inválido.");
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Readonly<Record<string, unknown>>;
  } catch {
    throw new Error("No fue posible leer la sesión autenticada.");
  }
}

function stringArray(value: unknown): readonly string[] {
  if (typeof value === "string" && value.trim()) return Object.freeze([value.trim()]);
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
}

function principalFromIdToken(idToken: string): StudioPrincipal {
  const claims = decodeJwtPayload(idToken);
  const actorId = typeof claims.user_id === "string" ? claims.user_id : typeof claims.sub === "string" ? claims.sub : "";
  const tenantId = typeof claims.tenantId === "string" ? claims.tenantId.trim() : typeof claims.tenant_id === "string" ? claims.tenant_id.trim() : "";
  if (!actorId || !tenantId) throw new Error("La cuenta no tiene tenantId autorizado. Configura los custom claims antes de usar Studio.");

  const roles = stringArray(claims.roles);
  const explicit = new Set(stringArray(claims.permissions));
  const elevated = roles.includes("tenant-admin") || roles.includes("platform-admin");
  const permissions = elevated
    ? STUDIO_PERMISSIONS
    : Object.freeze(STUDIO_PERMISSIONS.filter((permission) => explicit.has(permission)));

  if (!permissions.includes("assistants:read")) throw new Error("La cuenta no tiene permiso para acceder a GanoBot Studio.");
  return Object.freeze({ actorId, tenantId, permissions });
}

function toSession(value: FirebaseSignInResponse): FirebaseSession {
  if (!value.idToken || !value.refreshToken) throw new Error("Firebase no devolvió una sesión válida.");
  const expiresIn = Number(value.expiresIn ?? "3600");
  return Object.freeze({
    idToken: value.idToken,
    refreshToken: value.refreshToken,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    principal: principalFromIdToken(value.idToken),
    email: value.email ?? "",
  });
}

async function signIn(email: string, password: string): Promise<FirebaseSession> {
  const apiKey = requiredEnv("VITE_FIREBASE_API_KEY", import.meta.env.VITE_FIREBASE_API_KEY);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json() as FirebaseSignInResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message === "INVALID_LOGIN_CREDENTIALS" ? "Correo o contraseña incorrectos." : "No fue posible iniciar sesión con Firebase.");
  return toSession(body);
}

async function refreshSession(session: FirebaseSession): Promise<FirebaseSession> {
  const apiKey = requiredEnv("VITE_FIREBASE_API_KEY", import.meta.env.VITE_FIREBASE_API_KEY);
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }),
  });
  const body = await response.json() as FirebaseRefreshResponse;
  if (!response.ok || !body.id_token || !body.refresh_token) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
  const expiresIn = Number(body.expires_in ?? "3600");
  return Object.freeze({
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    principal: principalFromIdToken(body.id_token),
    email: session.email,
  });
}

function loadSession(): FirebaseSession | undefined {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as FirebaseSession;
    if (!value.idToken || !value.refreshToken || !value.principal?.tenantId) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function Login({ onAuthenticated }: { readonly onAuthenticated: (session: FirebaseSession) => void }): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form
        style={{ width: "min(420px, 100%)", display: "grid", gap: 16, padding: 28, border: "1px solid #d8d8d8", borderRadius: 18, background: "#fff" }}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          void signIn(email.trim(), password)
            .then((next) => { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); onAuthenticated(next); })
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No fue posible iniciar sesión."))
            .finally(() => setBusy(false));
        }}
      >
        <div><strong style={{ fontSize: 24 }}>GanoBot Studio</strong><p style={{ marginBottom: 0 }}>Acceso seguro al panel de configuración.</p></div>
        <label>Correo<input style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: 11 }} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Contraseña<input style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: 11 }} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}
        <button type="submit" disabled={busy} style={{ padding: 12, cursor: busy ? "wait" : "pointer" }}>{busy ? "Ingresando…" : "Ingresar"}</button>
      </form>
    </main>
  );
}

function AuthenticatedStudio({ session, onSession, onSignOut }: { readonly session: FirebaseSession; readonly onSession: (session: FirebaseSession) => void; readonly onSignOut: () => void }): React.JSX.Element {
  const tokenProvider = useMemo(() => async (): Promise<string> => {
    if (session.expiresAt - Date.now() > 60_000) return session.idToken;
    const next = await refreshSession(session);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    onSession(next);
    return next.idToken;
  }, [session, onSession]);

  const service = useMemo(() => new BackendAssistantStudioService({
    apiUrl: apiBaseUrl(),
    principal: session.principal,
    tokenProvider,
    chatTransportFactory: () => new HttpChatTransport({
      apiUrl: apiBaseUrl(),
      tokenProvider: { getAccessToken: tokenProvider },
    }),
  }), [session.principal, tokenProvider]);

  return <><button type="button" onClick={onSignOut} style={{ position: "fixed", zIndex: 10000, right: 16, top: 12, padding: "7px 11px" }}>Cerrar sesión</button><StudioApp service={service} /></>;
}

export function ProductionStudio(): React.JSX.Element {
  const [session, setSession] = useState<FirebaseSession | undefined>(() => loadSession());
  const [bootError, setBootError] = useState<string>();

  useEffect(() => {
    try {
      requiredEnv("VITE_FIREBASE_API_KEY", import.meta.env.VITE_FIREBASE_API_KEY);
      requiredEnv("VITE_FIREBASE_AUTH_DOMAIN", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
      requiredEnv("VITE_FIREBASE_PROJECT_ID", import.meta.env.VITE_FIREBASE_PROJECT_ID);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "Configuración Firebase incompleta.");
    }
  }, []);

  if (bootError) return <main style={{ padding: 32 }}><h1>GanoBot Studio no está configurado</h1><p>{bootError}</p></main>;
  if (!session) return <Login onAuthenticated={setSession} />;
  return <AuthenticatedStudio session={session} onSession={setSession} onSignOut={() => { sessionStorage.removeItem(SESSION_KEY); setSession(undefined); }} />;
}
