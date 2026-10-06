/**
 * What kind of device this is, decided once on the client.
 *
 * TOUCH: a phone or tablet. No mouse to look around with, no hover, no
 * keyboard: the walk is swiped, works are tapped, and the head turns toward
 * the work you are approaching on its own.
 *
 * LITE: a phone or tablet GPU. The scene keeps everything you see but drops
 * what costs the most for the least: the live floor reflection (it draws the
 * whole building a second time), two of the five stage lights, and the
 * 2048px prints, which a phone screen cannot show anyway (1280px are used).
 *
 * Both are false on the server; nothing that renders there depends on them.
 */
const touchScreen =
  typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

export const TOUCH = touchScreen;
export const LITE = touchScreen;
