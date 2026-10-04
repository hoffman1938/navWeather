import { useMessages } from '../../state/settings';

/**
 * Who the data comes from, and where to fix the map. The public OSRM servers
 * (FOSSGIS) ask for their attribution and a link to OpenStreetMap's
 * map-improvement page (docs/legal/LICENSING_MATRIX.md).
 */
export const FIX_THE_MAP_URL = 'https://www.openstreetmap.org/fixthemap';

export function Attribution() {
  const m = useMessages();
  return (
    <p className="attribution">
      {m.ui.attribution}{' '}
      <a href={FIX_THE_MAP_URL} target="_blank" rel="noopener noreferrer">
        {m.ui.fixMap}
      </a>
    </p>
  );
}
