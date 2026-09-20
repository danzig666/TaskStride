import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SmartView } from '../lib/tasks'
import type { AppLocale } from '../i18n'

type Theme = 'system' | 'light' | 'dark'
interface UiState {
  activeView: SmartView | string
  selectedTaskId?: string
  sidebarCollapsed: boolean
  theme: Theme
  density: 'comfortable' | 'compact'
  horizon: 7 | 14 | 30
  favoriteLists: string[]
  locale: AppLocale
  setActiveView(view: string): void
  selectTask(id?: string): void
  setTheme(theme: Theme): void
  setDensity(density: 'comfortable' | 'compact'): void
  toggleSidebar(): void
  setHorizon(horizon: 7 | 14 | 30): void
  toggleFavorite(id: string): void
  setLocale(locale: AppLocale): void
}
export const useUiStore = create<UiState>()(persist((set) => ({
  activeView: 'all', sidebarCollapsed: false, theme: 'system', density: 'comfortable', horizon: 7, favoriteLists: [], locale: navigator.language.toLowerCase().startsWith('hu') ? 'hu' : 'en',
  setActiveView: (activeView) => set({ activeView, selectedTaskId: undefined }), selectTask: (selectedTaskId) => set({ selectedTaskId }), setTheme: (theme) => set({ theme }), setDensity: (density) => set({ density }), toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })), setHorizon: (horizon) => set({ horizon }), toggleFavorite: (id) => set((state) => ({ favoriteLists: state.favoriteLists.includes(id) ? state.favoriteLists.filter((item) => item !== id) : [...state.favoriteLists, id] })), setLocale: (locale) => set({ locale }),
}), { name: 'taskflow-preferences', partialize: (state) => ({ activeView: state.activeView, sidebarCollapsed: state.sidebarCollapsed, theme: state.theme, density: state.density, horizon: state.horizon, favoriteLists: state.favoriteLists, locale: state.locale }) }))
