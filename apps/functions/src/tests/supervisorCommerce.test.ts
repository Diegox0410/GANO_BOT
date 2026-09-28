import assert from 'node:assert/strict'

import type {
  CommerceRequestContext,
} from '../commerce/contracts.js'

import type {
  CommerceEscalationInput,
  CommerceSupervisorPort,
} from '../commerce/supervisor.js'

import {
  createSupervisorTools,
  SUPERVISOR_TOOL_ID,
} from '../commerce/supervisorTools.js'

const calls: Array<{
  context: CommerceRequestContext
  input: CommerceEscalationInput
}> = []

const port: CommerceSupervisorPort = {
  async requestHumanEscalation(
    context,
    input,
  ) {
    calls.push({
      context,
      input,
    })

    return {
      escalationId: 'esc-1',
      conversationId:
        context.conversationId,
      status: 'OPEN',
      reason: input.reason,
      priority:
        input.priority ??
        'NORMAL',
    }
  },
}

const tools =
  createSupervisorTools(
    port,
    'tenant-floes',
    'commerce-assistant',
  )

assert.equal(
  tools.length,
  1,
)

const supervisorTool =
  tools[0]

assert.ok(
  supervisorTool,
)

assert.equal(
  supervisorTool.descriptor.id,
  SUPERVISOR_TOOL_ID,
)

const result =
  await supervisorTool.handler.execute(
    {
      reason: 'COMPLAINT',
      contextSummary:
        'Cliente reporta inconformidad',
    },
    {
      tenantId:
        'tenant-floes',

      assistantId:
        'commerce-assistant',

      actorId:
        'customer-1',

      conversationId:
        'conv-1',

      requestId:
        'req-h5',

      correlationId:
        'corr-h5',

      roles: [
        'user',
      ],

      permissions: [
        'tools:execute',
      ],

      allowedToolIds: [
        SUPERVISOR_TOOL_ID,
      ],

      allowedCategories: [
        'business',
      ],

      maximumRiskLevel:
        'medium',
    },
  )

assert.deepEqual(
  result,
  {
    escalationId:
      'esc-1',

    conversationId:
      'conv-1',

    status:
      'OPEN',

    reason:
      'COMPLAINT',

    priority:
      'NORMAL',
  },
)

const firstCall =
  calls[0]

assert.ok(
  firstCall,
)

assert.equal(
  firstCall.context.tenantId,
  'tenant-floes',
)

assert.equal(
  firstCall.context.idempotencyKey,
  'tenant-floes:req-h5:commerce.requestHumanEscalation',
)

await assert.rejects(
  () =>
    supervisorTool.handler.execute(
      {
        reason:
          'INVALID',
      },
      {
        tenantId:
          'tenant-floes',

        assistantId:
          'commerce-assistant',

        actorId:
          'customer-1',

        conversationId:
          'conv-1',

        requestId:
          'req-bad',

        correlationId:
          'corr-bad',

        roles: [
          'user',
        ],

        permissions: [
          'tools:execute',
        ],

        allowedToolIds: [
          SUPERVISOR_TOOL_ID,
        ],

        allowedCategories: [
          'business',
        ],

        maximumRiskLevel:
          'medium',
      },
    ),
  /Invalid escalation reason/,
)

console.log(
  'H5 Supervisor Commerce: escalamiento tipado, tenant-scoped e idempotente OK',
)