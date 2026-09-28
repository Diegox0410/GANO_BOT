# H5 — GanoBot Supervisor integration

GanoBot gains one typed tool: `commerce.requestHumanEscalation`.

The tool sends tenant, assistant, conversation, request, correlation and idempotency context server-side. Model arguments cannot choose the tenant or conversation id. Supported reasons mirror Chopify `EscalationReason`.

This tool only creates/returns a human escalation. It never approves payment, mutates inventory, or marks an order paid.
