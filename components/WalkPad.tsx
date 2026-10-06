'use client';

import { useEffect, useRef, useState } from 'react';
import { disableMotion, enableMotion, motionSupported, subscribeMotion } from '@/lib/motion';

const Chevron = ({ up }: { up: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d={up ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A phone turning in a hand: the "look by moving your phone" switch. */
const PhoneTurn = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <rect x="8.5" y="5" width="7" height="14" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4.5 9.5a8.5 8.5 0 0 0 0 5M19.5 9.5a8.5 8.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** A press longer than this walks; a shorter one is a tap. */
const HOLD_MS = 180;

/**
 * Walking on a phone: hold ▲ to walk on, ▼ to walk back; a quick tap glides
 * to the next (or previous) work instead. A press only starts walking once it
 * has lasted HOLD_MS, so a tap never nudges you before it glides. Looking around comes from the phone
 * itself (lib/motion), switched on and off with the small button above.
 */
export function WalkPad({ visible, onHold, onTap }: {
  visible: boolean;
  /** -1, 0 or 1: the button held down, or none. */
  onHold: (dir: -1 | 0 | 1) => void;
  onTap: (dir: -1 | 1) => void;
}) {
  const [down, setDown] = useState<-1 | 0 | 1>(0);
  /** The live value: a quick tap can end before React has re-rendered. */
  const downRef = useRef<-1 | 0 | 1>(0);
  const [motion, setMotion] = useState(false);
  const [canMove, setCanMove] = useState(false);
  const timer = useRef(0);

  useEffect(() => {
    setCanMove(motionSupported());
    return subscribeMotion(setMotion);
  }, []);

  // Released by losing the button (hidden mid-press, a call coming in…).
  useEffect(() => {
    if (!visible && downRef.current !== 0) {
      clearTimeout(timer.current);
      downRef.current = 0;
      setDown(0);
      onHold(0);
    }
  }, [visible, onHold]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const press = (dir: -1 | 1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    downRef.current = dir;
    setDown(dir);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      if (downRef.current === dir) onHold(dir);
    }, HOLD_MS);
  };
  const release = (dir: -1 | 1, tap: boolean) => () => {
    if (downRef.current !== dir) return;
    const wasTap = timer.current !== 0;
    clearTimeout(timer.current);
    timer.current = 0;
    downRef.current = 0;
    setDown(0);
    onHold(0);
    if (tap && wasTap) onTap(dir);
  };

  const button = (dir: -1 | 1, label: string) => (
    <button
      type="button"
      className={`walk-btn ${down === dir ? 'is-down' : ''}`}
      aria-label={label}
      tabIndex={visible ? 0 : -1}
      onPointerDown={press(dir)}
      onPointerUp={release(dir, true)}
      onPointerCancel={release(dir, false)}
      onLostPointerCapture={release(dir, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Chevron up={dir > 0} />
    </button>
  );

  return (
    <div className={`walkpad ${visible ? 'is-on' : ''}`} aria-hidden={!visible}>
      {canMove && (
        <button
          type="button"
          className={`look-toggle ${motion ? 'is-on' : ''}`}
          aria-label={motion ? 'Stop looking around with the phone' : 'Look around by moving the phone'}
          aria-pressed={motion}
          tabIndex={visible ? 0 : -1}
          onClick={() => (motion ? disableMotion() : void enableMotion())}
        >
          <PhoneTurn />
        </button>
      )}
      {button(1, 'Walk forward')}
      {button(-1, 'Walk back')}
    </div>
  );
}
