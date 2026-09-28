# H1 — Separación GanoBot Core / GanoSim

AI Core queda reutilizable y sin defaults MLM. GanoSim conserva sus reglas, entidades y políticas como perfil explícito.

```
GanoSim  ──► GanoBot Core
Commerce ──► GanoBot Core
GanoBot Core -/-> dominios
```

El runtime hospedado de GanoSim selecciona explícitamente `GANO_SIM_INTENT_CONFIG` y `GANO_SIM_PROMPT_CONFIG`. Commerce podrá incorporarse después sin heredar rangos, paquetes, PV/CV/GCV, binario ni GEN5.
