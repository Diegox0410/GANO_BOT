import assert from 'node:assert/strict'
import test from 'node:test'
import { createFirestoreOmnichannelDeliveryRepository } from '../scripts/firestore-omnichannel-delivery-ledger.mjs'

function fakeFirestore() {
  const records = new Map()
  let queue = Promise.resolve()
  const reference = (collection, id) => ({ collection, id,
    async get() {
      const value = records.get(`${collection}/${id}`)
      return { exists: value !== undefined, data: () => structuredClone(value ?? {}) }
    },
  })
  return {
    records,
    collection(name) { return { doc(id) { return reference(name, id) } } },
    runTransaction(operation) {
      const task = queue.then(async () => {
        const writes = []
        const transaction = {
          async get(ref) {
            const value = records.get(`${ref.collection}/${ref.id}`)
            return { exists: value !== undefined, data: () => structuredClone(value ?? {}) }
          },
          set(ref, value, options = {}) { writes.push({ ref, value, merge: options.merge === true }) },
          update(ref, value) { writes.push({ ref, value, merge: true }) },
        }
        const result = await operation(transaction)
        for (const write of writes) {
          const key = `${write.ref.collection}/${write.ref.id}`
          const current = records.get(key) ?? {}
          records.set(key, write.merge ? { ...current, ...structuredClone(write.value) } : structuredClone(write.value))
        }
        return result
      })
      queue = task.catch(() => undefined)
      return task
    },
  }
}

test('delivery stages survive repository reconstruction and complete exactly once', async () => {
  const firestore = fakeFirestore()
  const firstProcess = createFirestoreOmnichannelDeliveryRepository({ firestore, environment: { VERCEL_ENV: 'preview' } })
  await firstProcess.withLock('tenant-floes:META:INSTAGRAM:message-1', async ({ read, write }) => {
    assert.equal(await read(), undefined)
    await write({ tenantId: 'tenant-floes', provider: 'META', channel: 'INSTAGRAM', providerMessageId: 'message-1',
      stage: 'inbound-persisted', customerId: 'customer-1' })
  })

  const afterRestart = createFirestoreOmnichannelDeliveryRepository({ firestore, environment: { VERCEL_ENV: 'preview' } })
  await afterRestart.withLock('tenant-floes:META:INSTAGRAM:message-1', async ({ read, write }) => {
    assert.deepEqual(await read(), { stage: 'inbound-persisted', customerId: 'customer-1' })
    await write({ tenantId: 'tenant-floes', provider: 'META', channel: 'INSTAGRAM', providerMessageId: 'message-1',
      stage: 'outbound-pending', customerId: 'customer-1', result: { reply: 'Hola' },
      outbound: { text: 'Hola', correlationId: 'corr-1' } })
  })
  const replay = createFirestoreOmnichannelDeliveryRepository({ firestore, environment: { VERCEL_ENV: 'preview' } })
  const state = await replay.withLock('tenant-floes:META:INSTAGRAM:message-1', ({ read }) => read())
  assert.equal(state.stage, 'outbound-pending')
  assert.equal(state.outbound.correlationId, 'corr-1')
  assert.equal([...firestore.records.keys()][0].startsWith('ganobot_channel_deliveries_preview/'), true)
})

test('cross-instance concurrent processing acquires only one Firestore delivery lease', async () => {
  const firestore = fakeFirestore()
  const repositoryA = createFirestoreOmnichannelDeliveryRepository({ firestore, environment: { VERCEL_ENV: 'preview' } })
  const repositoryB = createFirestoreOmnichannelDeliveryRepository({ firestore, environment: { VERCEL_ENV: 'preview' } })
  let release
  const held = new Promise(resolve => { release = resolve })
  const first = repositoryA.withLock('tenant-floes:TIKTOK:TIKTOK:message-2', async () => held)
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(() => repositoryB.withLock('tenant-floes:TIKTOK:TIKTOK:message-2', async () => 'wrong'), /delivery-in-progress/)
  release('done')
  assert.equal(await first, 'done')
})

test('invalid or mismatched stage writes fail closed', async () => {
  const repository = createFirestoreOmnichannelDeliveryRepository({ firestore: fakeFirestore(), environment: { VERCEL_ENV: 'preview' } })
  await assert.rejects(() => repository.withLock('tenant-floes:WEB:WEB:message-3', ({ write }) => write({
    tenantId: 'tenant-floes', provider: 'WEB', channel: 'WEB', providerMessageId: 'message-3', stage: 'unknown',
  })), /durable-delivery-state-invalid/)
  await assert.rejects(() => repository.withLock('tenant-floes:WEB:WEB:message-4', ({ write }) => write({
    tenantId: 'tenant-mg', provider: 'WEB', channel: 'WEB', providerMessageId: 'message-4', stage: 'completed',
  })), /durable-delivery-state-invalid/)
})
