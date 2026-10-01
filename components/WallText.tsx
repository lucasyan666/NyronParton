'use client';

import { Text } from '@react-three/drei';
import type { Room } from '@/data/exhibition';

const SERIF = '/fonts/InstrumentSerif-Regular.ttf';
const ITALIC = '/fonts/InstrumentSerif-Italic.ttf';

/**
 * Room title and statement on the wall just inside the entrance, the way a
 * museum introduces a room. Placed in the room's local frame by Architecture.
 */
export function WallText({ room, index, position, rotationY, top, ink = '#ebe5d8', inkDim = '#a8a196' }: {
  room: Room;
  index: number;
  position: [number, number, number];
  rotationY: number;
  top: number;
  ink?: string;
  inkDim?: string;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Text font={ITALIC} fontSize={0.085} letterSpacing={0.18} color="#e0663d" anchorX="left" anchorY="bottom" position={[0, top + 0.34, 0]}>
        {`ROOM ${String(index + 1).padStart(2, '0')}`}
      </Text>
      <Text font={SERIF} fontSize={0.36} letterSpacing={-0.015} color={ink} anchorX="left" anchorY="bottom" position={[0, top, 0]} maxWidth={3.4}>
        {room.title}
      </Text>
      {room.statement && (
        <Text font={ITALIC} fontSize={0.13} lineHeight={1.35} color={inkDim} anchorX="left" anchorY="top" position={[0, top - 0.13, 0]} maxWidth={2.9}>
          {room.statement}
        </Text>
      )}
    </group>
  );
}
