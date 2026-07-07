import { hi } from './shared.js'
import './style.css'

console.log(hi)
import('./lazy.js').then(m => console.log(m.lazy))
