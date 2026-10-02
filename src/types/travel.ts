/** How the trip is made. Each has its own router (or none: see services/providers.ts). */
export const TRAVEL_MODES = ['drive', 'walk', 'bike', 'transit', 'flight'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/** Modes a person can follow turn by turn (the others are plans only). */
export const NAVIGABLE_MODES: readonly TravelMode[] = ['drive', 'walk', 'bike'];
