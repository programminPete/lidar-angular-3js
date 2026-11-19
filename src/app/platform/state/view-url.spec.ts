import { DEFAULT_VIEW, searchWithView, viewFromSearch } from './view-url';

describe('viewFromSearch', () => {
  it('starts in 3D when the address has no view parameter', () => {
    expect(DEFAULT_VIEW).toBe('3d');
    expect(viewFromSearch('')).toBe('3d');
    expect(viewFromSearch('?ws=ws://localhost:8787')).toBe('3d');
  });

  it('reads the plan and 3D views', () => {
    expect(viewFromSearch('?view=plan')).toBe('plan');
    expect(viewFromSearch('?view=3d')).toBe('3d');
  });

  it('accepts 2d as another name for the plan, in any letter case', () => {
    expect(viewFromSearch('?view=2d')).toBe('plan');
    expect(viewFromSearch('?view=2D')).toBe('plan');
    expect(viewFromSearch('?view=3D')).toBe('3d');
  });

  it('falls back to the default for a value it does not know', () => {
    expect(viewFromSearch('?view=map')).toBe(DEFAULT_VIEW);
  });
});

describe('searchWithView', () => {
  it('adds the view parameter', () => {
    expect(searchWithView('', 'plan')).toBe('?view=plan');
  });

  it('replaces an existing view parameter', () => {
    expect(searchWithView('?view=plan', '3d')).toBe('?view=3d');
  });

  it('keeps other parameters', () => {
    const search = searchWithView('?ws=ws://localhost:8787', 'plan');
    const params = new URLSearchParams(search);
    expect(params.get('ws')).toBe('ws://localhost:8787');
    expect(params.get('view')).toBe('plan');
  });
});
