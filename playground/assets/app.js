import './stimulus_bootstrap.js';
import { startStimulusApp } from '@symfony/reprise/stimulus'
import { registerReactControllerComponents } from '@symfony/ux-react'
import { registerVueControllerComponents } from '@symfony/ux-vue'
import './styles/app.css'
import { add, subtract } from './calc'
import krkr from './images/krkr.webp';

// UX React and UX Vue read their components from Vite's / Rsbuild's import.meta.glob()
// instead of Webpack's require.context(). The "eager" option is required.
registerReactControllerComponents(import.meta.glob('./react/controllers/**/*.{jsx,tsx}', { eager: true }))
registerVueControllerComponents(import.meta.glob('./vue/controllers/**/*.vue', { eager: true }))

const app = startStimulusApp()

console.log('This log comes from assets/app.js - welcome to AssetMapper! 🎉');
console.log('1 + 2 = ' + add(1, 2));
console.log('1 - 2 = ' + subtract(1, 2));

console.log('app');
console.log(krkr);
