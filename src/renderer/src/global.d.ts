import type { XmlFinderApi } from '../../preload/index'

declare global {
  interface Window {
    api: XmlFinderApi
  }
}

export {}
