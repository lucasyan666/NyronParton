'use client';

import { EXHIBITION } from '@/data/exhibition';
import type { Room } from '@/data/exhibition';

export function Hud({
  room,
  barRef,
  selected,
  visible,
}: {
  room: Room | null;
  /** Written directly by the scroll handler; this component never re-renders on scroll. */
  barRef: React.RefObject<HTMLDivElement>;
  /** A work is held: the chrome recedes so nothing competes with it. */
  selected: boolean;
  /** False during the intro. */
  visible: boolean;
}) {
  const index = room ? EXHIBITION.findIndex((r) => r.id === room.id) : -1;

  return (
    <div className={`hud ${selected ? 'is-held' : ''} ${visible ? '' : 'is-hidden'}`}>
      <header className="hud-top">
        <span className="hud-mark">Nyron Parton</span>
        <span className="hud-sub">Film photography · Manchester</span>
      </header>

      <div className="hud-room" key={room?.id ?? 'none'}>
        {room && (
          <>
            <span className="hud-room-index">
              {String(index + 1).padStart(2, '0')} — {String(EXHIBITION.length).padStart(2, '0')}
            </span>
            <h2 className="hud-room-title">{room.title}</h2>
          </>
        )}
      </div>

      <div className="hud-progress" aria-hidden>
        <div ref={barRef} className="hud-progress-fill" style={{ transform: 'scaleY(0)' }} />
      </div>

      <footer className="hud-bottom">
        <span>{selected ? 'Esc to return' : 'Scroll or hold W to walk · click a work · J / K next / previous'}</span>
      </footer>
    </div>
  );
}
