// renderer 的多國語言：LangContext 讓元件隨語言重繪，useT() 回傳 t。
import { createContext, useContext } from 'react'
import { t, type Lang } from '../../../shared/i18n'

export const LangContext = createContext<Lang>('zh-TW')

/** 讀取目前語言（語言改變時元件會重繪）並回傳 t。 */
export function useT(): typeof t {
  useContext(LangContext)
  return t
}
