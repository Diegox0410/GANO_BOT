# Universal Chat Widget

Widget conversacional reutilizable que consume la API del Hito 8. No contiene lógica de IA, conocimiento, memoria ni herramientas: esas capacidades permanecen detrás de `ChatTransport`.

## React

```tsx
import { AssistantWidget, HttpChatTransport } from "@gano-bot/chat-widget";

const transport = new HttpChatTransport({
  apiUrl: "/api",
  tokenProvider: { getAccessToken: async () => sessionToken },
});

<AssistantWidget
  config={{
    assistantId: "assistant-demo",
    apiUrl: "/api",
    transport,
    theme: "system",
    citationsEnabled: true,
    streamingEnabled: true,
  }}
/>;
```

## JavaScript y Web Component

```js
import { defineAssistantWidgetElement } from "@gano-bot/chat-widget";
defineAssistantWidgetElement();
```

```html
<enterprise-assistant
  assistant-id="assistant-demo"
  api-url="https://api.example.com"
  theme="system"
>
</enterprise-assistant>
```

El elemento utiliza Shadow DOM. Los atributos admitidos se validan y no permiten configurar headers ni tokens. Para autenticación dinámica o callbacks debe utilizarse la API React/JavaScript.

## Transportes

- `HttpChatTransport`: backend HTTP y SSE, timeout, cancelación, token provider y allowlist de headers.
- `DirectApiTransport`: invoca directamente un objeto compatible con `BackendApplication` para integración y pruebas.
- `MockChatTransport`: adaptador explícitamente no productivo para demos deterministas.

Cuando SSE no está disponible, `AssistantWidget` degrada a `POST /v1/chat`. Los eventos por etapas no se presentan como deltas de tokens.

## Persistencia

`LocalStorageAdapter` e `InMemoryStorageAdapter` guardan exclusivamente `conversationId`, estado visual, tema y timestamp. No guardan mensajes, documentos, tokens ni credenciales. La clave está aislada por tenant y asistente.

## Seguridad y accesibilidad

El contenido se renderiza como texto React escapado, las URLs sólo aceptan HTTP/HTTPS y no se usa `dangerouslySetInnerHTML`. El widget incorpora nombres accesibles, región viva, controles táctiles, foco visible, Escape, contraste, responsive móvil, safe areas y reducción de movimiento.
