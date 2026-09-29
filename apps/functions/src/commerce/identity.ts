import type { CommerceRequestContext } from './contracts.js'

export type CommerceIdentityChannel='WHATSAPP'|'INSTAGRAM'|'FACEBOOK'|'WEB'|'OTHER'
export interface CommerceResolveIdentityInput {
 readonly channel:CommerceIdentityChannel
 readonly externalIdentifier:string
 readonly name?:string
 readonly phone?:string
 readonly email?:string
 readonly acquisitionSource?:string
}
export interface CommerceResolvedIdentity {
 readonly customerId:string
 readonly identityId:string
 readonly channel:CommerceIdentityChannel
 readonly externalIdentifier:string
 readonly createdCustomer:boolean
 readonly createdIdentity:boolean
}
export interface CommerceIdentityPort {
 resolveCustomerIdentity(context:CommerceRequestContext,input:CommerceResolveIdentityInput):Promise<CommerceResolvedIdentity>
}
