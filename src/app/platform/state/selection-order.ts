import type { Track } from '../data/track.model';
import type { SelectionDirection } from './platform-state.model';

/**
 * The id to select after stepping once in `direction`. People are ordered along the platform
 * (x, ties broken by id) and the order wraps at both ends. With nothing selected, or the selected
 * person gone, `next` starts at the first person and `previous` at the last.
 */
export function steppedSelectionId(
  tracks: readonly Track[],
  selectedId: string | null,
  direction: SelectionDirection,
): string | null {
  if (tracks.length === 0) {
    return null;
  }
  const ordered = [...tracks].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const currentIndex = ordered.findIndex((track) => track.id === selectedId);
  const step = direction === 'next' ? 1 : -1;

  if (currentIndex === -1) {
    const startIndex = direction === 'next' ? 0 : ordered.length - 1;
    return ordered[startIndex].id;
  }
  const nextIndex = (currentIndex + step + ordered.length) % ordered.length;
  return ordered[nextIndex].id;
}
