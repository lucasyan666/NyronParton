'use client';

import { WING_LAYOUTS } from '@/lib/layout';
import { TOUCH } from '@/lib/device';

const pad = (n: number) => String(n).padStart(2, '0');

/** Three small chevrons with a travelling pulse, echoing the arrows on the floor. */
export function PulseChevrons() {
  return (
    <span className="pulse-chevrons" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * The foyer's choice, in the DOM: one button per room, bottom centre. The
 * same choice is on the floor in front of every door; this is the version a
 * keyboard, a screen reader, or someone who has not spotted the arrows can use.
 */
export function RoomPicker({ visible, active, next, onEnter }: {
  visible: boolean;
  active: number | null;
  /** The room that scrolling on leads into; its button fills as you push. */
  next: number | null;
  onEnter: (wing: number) => void;
}) {
  const n = WING_LAYOUTS.length;
  const nextTitle = next == null ? null : WING_LAYOUTS[next]?.wing.title;
  return (
    <nav className={`picker ${visible ? 'is-on' : ''}`} aria-label="Choose a room" aria-hidden={!visible}>
      <span className="picker-label">Choose a room</span>
      <div className="picker-rooms">
        {WING_LAYOUTS.map((wl) => (
          <button
            key={wl.index}
            type="button"
            className={`picker-room ${wl.index === active ? 'is-current' : ''} ${wl.index === next ? 'is-next' : ''}`}
            onClick={() => onEnter(wl.index)}
            tabIndex={visible ? 0 : -1}
          >
            <span className="picker-index">{pad(wl.index + 1)}</span>
            <span className="picker-title">{wl.wing.title}</span>
            <span className="picker-mood" data-mood={wl.mood} aria-hidden />
            <PulseChevrons />
          </button>
        ))}
      </div>
      <span className="picker-hint">
        {TOUCH ? (
          nextTitle ? (
            <>
              Hold ▲ for <em>{nextTitle}</em>, or tap a room
            </>
          ) : (
            <>Tap a room</>
          )
        ) : nextTitle ? (
          <>
            Keep scrolling for <em>{nextTitle}</em>, or press 1–{n}
          </>
        ) : (
          <>or press 1–{n}</>
        )}
      </span>
    </nav>
  );
}
