/**
 * How the health twin is shown:
 *  - `astronaut`: the crew member in their suit, the friendly resting view;
 *  - `scan`: the suit turns into a faint hologram and the anatomy shows through it;
 *  - `anatomy`: the anatomy alone, for exploring one body system at a time.
 */
export const TWIN_VIEWS = ['astronaut', 'scan', 'anatomy'] as const;
export type TwinView = (typeof TWIN_VIEWS)[number];

export const TWIN_VIEW_LABEL: Record<TwinView, string> = {
  astronaut: 'Astronaut',
  scan: 'Scan',
  anatomy: 'Anatomy',
};

/** Body systems can only be pointed at once the anatomy is on show. */
export const showsAnatomy = (view: TwinView): boolean => view !== 'astronaut';
