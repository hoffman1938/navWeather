import { useEffect, useRef, useState } from 'react';
import { getProviders } from '../../services/providers';
import { useMessages, useSettings } from '../../state/settings';
import { getVoiceQueue, useAppStore } from '../../state/store';
import { listenAndAnswer } from '../../voice/assistant';
import { MicIcon, SpeakerIcon } from '../Icons/Icons';
import { LocateButton } from '../Map/LocateButton';
import './Voice.css';

/**
 * Right-hand map buttons: my location, push-to-talk mic, mute. Not a chat
 * window: a one-line caption shows "Listening…", then the short answer.
 */
export function VoiceControls() {
  const m = useMessages();
  const hasPlan = useAppStore((s) => s.plan !== null);
  const driving = useAppStore((s) => s.mode !== 'planning');
  const activity = useAppStore((s) => s.assistant.activity);
  const transcript = useAppStore((s) => s.assistant.transcript);
  const reply = useAppStore((s) => s.assistant.reply);
  const voiceOn = useSettings((s) => s.voice);
  const stop = useRef<(() => void) | null>(null);
  const [showReply, setShowReply] = useState(false);

  useEffect(() => {
    if (!reply) return;
    setShowReply(true);
    const t = window.setTimeout(() => setShowReply(false), 7000);
    return () => window.clearTimeout(t);
  }, [reply]);

  if (!hasPlan) {
    return (
      <div className="voice">
        <LocateButton />
      </div>
    );
  }
  const listening = activity === 'listening';
  const supported = getProviders().speechRecognition.supported;

  const toggleMic = () => {
    if (listening) {
      stop.current?.();
      useAppStore.getState().setAssistant({ activity: 'idle' });
      return;
    }
    stop.current = listenAndAnswer();
  };
  const toggleVoice = () => {
    const next = !voiceOn;
    useSettings.getState().update({ voice: next });
    getVoiceQueue().setMuted(!next);
  };

  const caption =
    activity === 'listening' ? transcript || m.assistant.listening : activity === 'thinking' ? transcript : showReply ? reply?.text : null;

  return (
    <div className="voice">
      {caption ? (
        <p className="voice__caption" role="status">
          {caption}
        </p>
      ) : null}
      {!driving ? <LocateButton /> : null}
      <div className="voice__buttons">
        {driving ? (
          <button className="fab" onClick={toggleVoice} aria-pressed={!voiceOn} aria-label={voiceOn ? m.ui.mute : m.ui.unmute}>
            <SpeakerIcon size={22} muted={!voiceOn} />
          </button>
        ) : null}
        <button
          className={`fab fab--mic${listening ? ' is-listening' : ''}`}
          onClick={toggleMic}
          aria-pressed={listening}
          aria-label={supported ? m.ui.voice : `${m.ui.voice} — ${m.assistant.unsupported}`}
        >
          {activity === 'thinking' ? <span className="spinner" aria-hidden="true" /> : <MicIcon size={24} />}
        </button>
      </div>
    </div>
  );
}
