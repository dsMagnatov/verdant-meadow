// Keep the approved desktop composition in one coordinate system. A wider
// window reveals more scenery; a narrower one fits the same reference width.
import { JOURNEY_SCROLL_VIEWPORTS } from './scroll-journey.js';

export const REFERENCE_WIDTH = 1909;
export const REFERENCE_HEIGHT = 1244;
export const COMPACT_QUERY = '(max-width: 900px), (max-aspect-ratio: 1/1)';

export function createViewport() {
  const compact = window.matchMedia(COMPACT_QUERY);
  let width = window.innerWidth, height = window.innerHeight;
  let journeyHeight = height;
  const state = { width, height, mobile: compact.matches, scale: 1, fov: 48, pixelRatio: 1 };

  function sync(preserveProgress = true) {
    const nextWidth = window.innerWidth, nextHeight = window.innerHeight;
    const mobile = compact.matches;
    const progress = window.scrollY / (JOURNEY_SCROLL_VIEWPORTS * journeyHeight);
    // Phone browser bars change the visible height during a swipe. They must
    // not change the scroll distance or move the camera to another story tile.
    const reflow = !mobile || Math.abs(nextWidth - width) > 2 || mobile !== state.mobile;
    if (reflow) journeyHeight = nextHeight;
    width = nextWidth; height = nextHeight;
    const scale = Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT);
    const aspect = width / height;
    const fov = mobile ? (aspect < 1 ? 60 : 48)
      : Math.atan(Math.tan(24 * Math.PI / 180) * Math.max(1, REFERENCE_WIDTH / REFERENCE_HEIGHT / aspect)) * 360 / Math.PI;
    const pixelBudget = mobile ? 1_000_000 : 6_000_000;
    Object.assign(state, { width, height, mobile, scale, fov,
      pixelRatio: Math.min(window.devicePixelRatio, mobile ? 1.25 : 1.6, Math.sqrt(pixelBudget / (width * height))) });
    const style = document.documentElement.style;
    style.setProperty('--u', `${scale}px`);
    style.setProperty('--reference-inset', `${(height - REFERENCE_HEIGHT * scale) / 2}px`);
    style.setProperty('--view-height', `${height}px`);
    style.setProperty('--scroll-viewport', `${journeyHeight}px`);
    if (preserveProgress && reflow) window.scrollTo({ top: Math.min(1, progress) * JOURNEY_SCROLL_VIEWPORTS * journeyHeight, behavior: 'instant' });
    return state;
  }

  sync(false);
  return { state, sync, readJourneyHeight: () => journeyHeight };
}
