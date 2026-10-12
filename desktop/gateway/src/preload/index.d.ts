import type { GatewayApi } from './index'

declare global {
  interface Window {
    gateway: GatewayApi
  }
}

export {}
