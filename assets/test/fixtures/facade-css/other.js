// Importing from app.js is what forces app to be split into a shared real chunk + facade entry.
import { a } from './app.js';

console.log(a);
