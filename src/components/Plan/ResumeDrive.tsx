import { useState } from 'react';
import { getProviders } from '../../services/providers';
import { clearDriveSession, readDriveSession, type DriveSession } from '../../state/driveSession';
import { useExplore } from '../../state/explore';
import { useMessages } from '../../state/settings';
import { getVoiceQueue, useAppStore } from '../../state/store';
import { NavigateIcon } from '../Icons/Icons';

// Read once per page load: a drive in progress before an accidental reload.
let pending: DriveSession | null | undefined;
export function takeResumableDrive(): DriveSession | null {
  if (pending === undefined) pending = readDriveSession();
  return pending;
}

/** "Continue to Batumi?" — after a reload mid-drive; starts only when tapped. */
export function ResumeDrive({ onDone }: { onDone: () => void }) {
  const m = useMessages();
  const [session] = useState(takeResumableDrive);
  if (!session) return null;
  const finish = () => {
    pending = null;
    onDone();
  };
  const resume = async () => {
    clearDriveSession(); // used up; navigation saves it again once it starts
    finish();
    // Inside the tap: voice and the location prompt need a user gesture.
    getVoiceQueue();
    getProviders().tts.unlock();
    useExplore.getState().useMyLocationAsOrigin(true);
    const st = useAppStore.getState();
    st.setTravelMode(session.mode);
    st.setDestinationPlace(session.destination);
    session.waypoints.forEach((w, i) => {
      useAppStore.getState().addWaypoint();
      useAppStore.getState().setWaypointPlace(i, w);
    });
    await useAppStore.getState().calculateRoute();
    if (useAppStore.getState().plan) await useAppStore.getState().requestNavigation();
  };
  return (
    <div className="resume">
      <p className="resume__text">
        <strong>{m.resume.title(session.destination.name)}</strong>
        <span>{m.resume.body}</span>
      </p>
      <div className="resume__actions">
        <button className="btn btn-primary" onClick={() => void resume()}>
          <NavigateIcon size={18} />
          {m.resume.continue}
        </button>
        <button
          className="btn btn-quiet"
          onClick={() => {
            clearDriveSession();
            finish();
          }}
        >
          {m.resume.dismiss}
        </button>
      </div>
    </div>
  );
}
