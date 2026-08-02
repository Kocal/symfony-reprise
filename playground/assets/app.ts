import './styles/app.css'
import { startStimulusApp } from '@symfony/reprise/stimulus'
import { registerReactControllerComponents } from '@symfony/ux-react'
import { registerVueControllerComponents } from '@symfony/ux-vue'

registerReactControllerComponents(import.meta.glob('./react/controllers/**/*.{jsx,tsx}', { eager: true }))
registerVueControllerComponents(import.meta.glob('./vue/controllers/**/*.vue', { eager: true }))

startStimulusApp()

// Code-splitting showcase: the confetti module is pulled in only on click, so it ships as its own
// chunk (listed in entrypoints.json -> dynamic) instead of the main entry. Delegated on `document` so it
// keeps working across Turbo navigations — the entry script runs once, not on every page.
document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-confetti]')) {
        void import('./demos/confetti').then((m) => m.celebrate())
    }
})
