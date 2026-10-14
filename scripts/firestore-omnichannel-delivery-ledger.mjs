import { createHash, randomUUID } from 'node:crypto'
import { resolveHostedFirestoreCollections } from './hosted-firestore-collections.mjs'

const STAGES = new Set(['inbound-persisted', 'outbound-pending', 'completed', 'human-blocked'])
const KEY = /^[A-Za-z0-9:_-]{1,1024}$/
const idFor = key => createHash('sha256').update(key).digest('hex')

/** Firestore-backed durable retry ledger with a renewable per-inbound processing lease. */
export function createFirestoreOmnichannelDeliveryRepository({ firestore, environment = process.env, now = () => Date.now(), leaseMs = 240_000, heartbeatMs = 30_000 }) {
  if (!firestore || typeof firestore.collection !== 'function' || typeof firestore.runTransaction !== 'function') throw new Error('durable-delivery-firestore-required')
  if (!Number.isInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 600_000 || !Number.isInteger(heartbeatMs) || heartbeatMs < 1000 || heartbeatMs >= leaseMs) throw new Error('durable-delivery-lease-invalid')
  const collectionName = resolveHostedFirestoreCollections(environment).channelDeliveries
  const collection = firestore.collection(collectionName)

  return Object.freeze({
    async withLock(key, operation) {
      if (typeof key !== 'string' || !KEY.test(key) || typeof operation !== 'function') throw new Error('durable-delivery-key-invalid')
      const ref = collection.doc(idFor(key))
      const ownerId = randomUUID()
      const acquired = await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const current = snapshot.exists ? snapshot.data() : {}
        if (Number(current.lockUntil || 0) > now()) return false
        transaction.set(ref, { keyHash: idFor(key), lockOwnerId: ownerId, lockUntil: now() + leaseMs,
          updatedAt: new Date(now()).toISOString() }, { merge: true })
        return true
      })
      if (!acquired) throw new Error('delivery-in-progress')
      let lost = false
      const renew = setInterval(() => {
        void firestore.runTransaction(async transaction => {
          const snapshot = await transaction.get(ref)
          if (!snapshot.exists || snapshot.data().lockOwnerId !== ownerId) { lost = true; return }
          transaction.update(ref, { lockUntil: now() + leaseMs })
        }).catch(() => { lost = true })
      }, heartbeatMs)
      renew.unref?.()

      const assertOwner = snapshot => {
        if (lost || !snapshot.exists || snapshot.data().lockOwnerId !== ownerId || Number(snapshot.data().lockUntil || 0) <= now()) throw new Error('delivery-lock-lost')
      }
      const operations = Object.freeze({
        async read() {
          const snapshot = await ref.get()
          assertOwner(snapshot)
          const current = snapshot.data()
          if (!current.stage) return undefined
          if (!STAGES.has(current.stage)) throw new Error('durable-delivery-stage-invalid')
          if (current.keyHash !== idFor(key)) throw new Error('durable-delivery-key-mismatch')
          return Object.freeze(Object.fromEntries(['stage', 'customerId', 'result', 'outbound'].filter(field => current[field] !== undefined).map(field => [field, current[field]])))
        },
        async write(state) {
          if (!state || !STAGES.has(state.stage) || typeof state.tenantId !== 'string' || !key.startsWith(`${state.tenantId}:`) || typeof state.provider !== 'string'
            || typeof state.channel !== 'string' || typeof state.providerMessageId !== 'string') throw new Error('durable-delivery-state-invalid')
          await firestore.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref)
            assertOwner(snapshot)
            transaction.set(ref, {
              keyHash: idFor(key), tenantId: state.tenantId, provider: state.provider, channel: state.channel,
              providerMessageId: state.providerMessageId, stage: state.stage, customerId: state.customerId || '',
              ...(state.result ? { result: state.result } : {}), ...(state.outbound ? { outbound: state.outbound } : {}),
              lockOwnerId: ownerId, lockUntil: now() + leaseMs, updatedAt: new Date(now()).toISOString(),
            }, { merge: true })
          })
        },
      })
      try { return await operation(operations) }
      finally {
        clearInterval(renew)
        await firestore.runTransaction(async transaction => {
          const snapshot = await transaction.get(ref)
          if (snapshot.exists && snapshot.data().lockOwnerId === ownerId) transaction.update(ref, { lockOwnerId: '', lockUntil: 0 })
        }).catch(() => undefined)
      }
    },
  })
}

export function createDefaultOmnichannelDeliveryRepository({ environment = process.env, getFirestore, ...options } = {}) {
  const resolveFirestore = getFirestore ?? (() => {
    // Loaded lazily so Preview/local wiring can inject its own emulator or fake.
    return import('../apps/functions/dist/integrations/firebaseAdmin.js').then(module => module.getGanoAdminFirestore())
  })
  let repository
  return Object.freeze({
    withLock(key, operation) {
      if (!repository) repository = Promise.resolve(resolveFirestore()).then(firestore => createFirestoreOmnichannelDeliveryRepository({ firestore, environment, ...options }))
      return repository.then(value => value.withLock(key, operation))
    },
  })
}
