import { EXHIBITION, thumbOf } from '@/data/exhibition';

/**
 * Everything inside the WebGL canvas is invisible to crawlers and screen
 * readers. This is the same exhibition as real HTML — visually hidden, fully
 * indexable, fully navigable by keyboard and assistive tech.
 *
 * Do not delete this because it "does nothing on screen". It is the only
 * version of the site Google and a screen reader will ever see.
 */
export function SemanticIndex() {
  return (
    <div className="sr-only">
      <h1>Nyron Parton — Film Photography</h1>

      {/* The intro copy lives inside the client-only 3D bundle, so it is
          repeated here — otherwise the bio is invisible to crawlers and to
          screen readers, which is the whole reason this component exists. */}
      <section>
        <h2>About</h2>
        <p>Nyron Parton is a film photographer based in Manchester and the West Midlands.</p>
        <p>
          Shot on film — dancefloors, back rooms, and long walks in unfamiliar
          cities. Documentary work about the people he is actually with.
        </p>
        <p>Prints at @nizprints. Available for commissions.</p>
      </section>
      {EXHIBITION.map((room) => (
        <section key={room.id}>
          <h2>{room.title}</h2>
          {room.statement && <p>{room.statement}</p>}
          <ul>
            {room.photos.map((photo) => (
              <li key={photo.id}>
                <article>
                  <h3>{photo.title}</h3>
                  <img
                    src={photo.src}
                    srcSet={`${thumbOf(photo.src)} 400w, ${photo.src} 2048w`}
                    sizes="(max-width: 700px) 100vw, 50vw"
                    alt={photo.caption || photo.title}
                    loading="lazy"
                    decoding="async"
                    width={800}
                    height={Math.round(800 / photo.aspect)}
                  />
                  <p>{photo.caption}</p>
                  <p>{[photo.year, photo.medium, photo.place].filter(Boolean).join(' · ')}</p>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
