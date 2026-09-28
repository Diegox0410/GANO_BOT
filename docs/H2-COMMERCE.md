# H2 — GanoBot Commerce Contracts & Tools

## Objetivo

Introducir el dominio Commerce como consumidor independiente de GanoBot Core, sin reutilizar ni contaminar el adaptador de GanoSim.

## Frontera

```text
GanoSim ─────► GanoBot Core
Commerce ────► GanoBot Core
   │
   ▼
CommercePort
   │
   ▼
ChopifyAdapter (H3)
```

`CommercePort` define la frontera operacional. H2 no conoce HTTP, Firebase ni detalles internos de Chopify.

## Operaciones

- `searchProducts`
- `getProductDetails`
- `checkAvailability`
- `createOrUpdateCustomer`
- `createOpportunity`
- `createOrderDraft`
- `attachPaymentProof`
- `getOrderStatus`

## Invariantes

1. Tenant y assistant se derivan del `ToolExecutionContext`, no de argumentos del modelo.
2. Cada operación recibe request/correlation/idempotency context.
3. `createOrderDraft` crea un borrador; no confirma pago ni descuenta inventario directamente.
4. `attachPaymentProof` devuelve `status: "pending_review"`; PaymentProof no equivale a Payment.
5. El asistente no inventa catálogo, precio, stock, pedido o estado de pago.
6. GanoSim conserva su adaptador MLM independiente.
7. H2 no conecta aún con Chopify: esa implementación corresponde a H3.
