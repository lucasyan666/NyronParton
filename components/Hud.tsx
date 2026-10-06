'use client';

import { WING_LAYOUTS, type WingLayout } from '@/lib/layout';
import type { Room } from '@/data/exhibition';
import { TOUCH } from '@/lib/device';

const pad = (n: number) => String(n).padStart(2, '0');

export function Hud({
  wing,
  room,
  inFoyer,
  barRef,
  selected,
  visible,
  light,
}: {
  /** The chosen wing, or null while choosing. */
  wing: WingLayout | null;
  /** The room the camera is standing in. */
  room: { room: Room; roomIndex: number } | null;
  inFoyer: boolean;
  /** Written directly by the scroll handler; this component never re-renders on scroll. */
  barRef: React.RefObject<HTMLDivElement>;
  /** A work is held: the chrome recedes so nothing competes with it. */
  selected: boolean;
  /** False during the intro. */
  visible: boolean;
  /** Pale room: dark ink. */
  light: boolean;
}) {
  const n = WING_LAYOUTS.length;
  const inWing = !inFoyer && wing;
  const key = inWing ? `${wing.index}-${room?.roomIndex ?? 0}` : 'foyer';

  // A phone has no keys and no Esc: swipe, tap, and tap again (or ×) to close.
  const hint = selected
    ? TOUCH ? 'Tap the photo again to return' : 'Esc to return'
    : inWing
      ? TOUCH ? 'Swipe up to walk · tap a work' : 'Scroll or hold W to walk · click a work · H for the foyer'
      : n > 1
        ? ''
        : TOUCH ? 'Swipe up to walk' : 'Scroll or hold W to walk';

  return (
    <div className={`hud ${selected ? 'is-held' : ''} ${visible ? '' : 'is-hidden'} ${light ? 'is-light' : ''} ${inWing ? '' : 'is-foyer'}`}>
      <header className="hud-top">
        <span className="hud-mark">Nyron Parton</span>
        <span className="hud-sub">Film photography · Manchester</span>
      </header>

      <div className="hud-room" key={key}>
        {inWing ? (
          <>
            <span className="hud-room-index">
              Room {pad(wing.index + 1)} — {pad(n)}
            </span>
            <h2 className="hud-room-title">{wing.wing.title}</h2>
            {wing.rooms.length > 1 && room && (
              <p className="hud-room-sub">
                {room.roomIndex + 1} of {wing.rooms.length}
                {room.room.title !== wing.wing.title ? ` · ${room.room.title}` : ''}
              </p>
            )}
          </>
        ) : (
          <>
            <span className="hud-room-index">The foyer</span>
            <h2 className="hud-room-title">{n > 1 ? `${n} rooms` : wing?.wing.title}</h2>
          </>
        )}
      </div>

      <div className="hud-progress" aria-hidden>
        <div ref={barRef} className="hud-progress-fill" style={{ transform: 'scaleY(0)' }} />
      </div>

      <footer className="hud-bottom">
        <span>{hint}</span>
      </footer>
    </div>
  );
}
