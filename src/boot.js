import './style.css';
import { preloader } from './preloader.js';

preloader.mark('boot');
Promise.allSettled([
  document.fonts.load('400 16px "Instrument Serif"'),
  document.fonts.load('italic 400 16px "Instrument Serif"'),
  document.fonts.load('400 16px "Kapakana"'),
]).then(() => preloader.mark('fonts'));

// Paint the lightweight loader before downloading and initializing Three.js.
import('./main.js').then(() => preloader.mark('engine')).catch(error => {
  console.error('Scene could not initialize', error);
  preloader.fail();
});
