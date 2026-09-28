'use client';

import { useState } from 'react';
import { EXHIBITION, thumbOf, type Photo } from '@/data/exhibition';

/**
 * The 2D show. Same editorial structure: photographs are visible, and tapping
 * one opens its caption. The work is never hidden behind a cover — a portfolio
 * that conceals its own images is working against the photographer.
 */
function Plate({ photo, eager }: { photo: Photo; eager: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <figure className={`plate ${open ? 'is-open' : ''}`}>
      <button
        className="plate-surface"
        style={{ aspectRatio: String(photo.aspect) }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <img
          src={photo.src}
          srcSet={`${thumbOf(photo.src)} 400w, ${photo.src} 2048w`}
          sizes="(max-width: 700px) 100vw, 50vw"
          alt={photo.caption || photo.title}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
        />
      </button>

      <figcaption className="plate-caption">
        <h3>{photo.title}</h3>
        <p className="plate-meta">{[photo.year, photo.medium].filter(Boolean).join(' · ')}</p>
        {open && photo.caption && <p>{photo.caption}</p>}
      </figcaption>
    </figure>
  );
}

export function FlatGallery() {
  return (
    <div className="flat">
      <header className="flat-head">
        <span className="hud-mark">Nyron Parton</span>
        <span className="hud-sub">Film photography · Manchester</span>
      </header>

      {/* The 3D route opens with a scroll-driven profile; the flat route gets
          the same copy as a static masthead so both tell the same story. */}
      <section className="flat-intro">
        <p className="flat-lead">
          Film photographer. Nights, friends, and the places in between.
        </p>
        <div className="flat-intro-cols">
          <div>
            <span className="intro-key">Practice</span>
            <p>
              Shot on film — dancefloors, back rooms, long walks in unfamiliar
              cities. Documentary work about the people I am actually with.
            </p>
          </div>
          <div>
            <span className="intro-key">Based</span>
            <p>Manchester and the West Midlands. Prints at @nizprints. Available for commissions.</p>
          </div>
        </div>
      </section>

      {EXHIBITION.map((room, roomIndex) => (
        <section className="flat-room" key={room.id}>
          <h2 className="flat-room-title">{room.title}</h2>
          {room.statement && <p className="flat-room-statement">{room.statement}</p>}
          <div className="flat-grid">
            {room.photos.map((photo, i) => (
              <Plate key={photo.id} photo={photo} eager={roomIndex === 0 && i < 2} />
            ))}
          </div>
        </section>
      ))}

      <footer className="flat-foot">
        <span>Nyron Parton · Manchester</span>
        <nav aria-label="Elsewhere">
          <a href="https://www.instagram.com/nyronparton" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a href="https://www.instagram.com/nizprints" target="_blank" rel="noopener noreferrer">Prints</a>
        </nav>
      </footer>
    </div>
  );
}
