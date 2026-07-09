import './stimulus_bootstrap.js';
import { startStimulusApp } from '@kocal/unplugin-symfony/stimulus'
import './styles/app.css'
import { add, subtract } from './calc'
import krkr from './images/krkr.webp';

const app = startStimulusApp()

console.log('This log comes from assets/app.js - welcome to AssetMapper! 🎉');
console.log('1 + 2 = ' + add(1, 2));
console.log('1 - 2 = ' + subtract(1, 2));

console.log('app');
console.log(krkr);
