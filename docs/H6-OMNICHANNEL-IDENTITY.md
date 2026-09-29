# H6 — GanoBot Omnichannel Identity

Adds the typed tool `commerce.resolveCustomerIdentity`.

The tenant comes exclusively from `ToolExecutionContext`; the model cannot choose another tenant. The operation accepts channel + external identifier and optional profile hints, then delegates customer resolution to Chopify.

This is the identity foundation for WhatsApp, Instagram, Facebook, Web and manual/other channels.
