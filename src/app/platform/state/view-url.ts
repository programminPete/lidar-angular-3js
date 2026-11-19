import type { PlatformView } from './platform-state.model';

/** The view shown when the address has no `view` parameter, or one that is not recognised. */
export const DEFAULT_VIEW: PlatformView = '3d';

const VIEW_PARAM = 'view';

/** "?view=plan" → 'plan'. "2d" is accepted as another name for the plan. */
export function viewFromSearch(search: string): PlatformView {
  const value = new URLSearchParams(search).get(VIEW_PARAM)?.toLowerCase();
  if (value === 'plan' || value === '2d') {
    return 'plan';
  }
  if (value === '3d') {
    return '3d';
  }
  return DEFAULT_VIEW;
}

/** The same query string with `view` set, keeping other parameters such as `ws`. */
export function searchWithView(search: string, view: PlatformView): string {
  const params = new URLSearchParams(search);
  params.set(VIEW_PARAM, view);
  return `?${params.toString()}`;
}

export function readViewFromAddress(): PlatformView {
  return viewFromSearch(window.location.search);
}

/** Keeps the address in step with the toggle so the current view can be linked to. Adds no history entry. */
export function writeViewToAddress(view: PlatformView): void {
  const { pathname, search, hash } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${searchWithView(search, view)}${hash}`);
}
