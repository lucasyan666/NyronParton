# Drop folder

Each folder in here becomes a room in the foyer, with its own door, title and
look. Put one style of photograph in each folder:

    drop/
      hero.jpg                  the landing photograph (optional)
      01-nights/                → a room called "Nights"
        01.jpg 02.jpg …           hung in filename order
      02-black-and-white/
        room.json               optional, see below
        …
      03-travel/
        …

Then run:

    npm run photos:scan

and restart the dev server. Names, formats and sizes do not matter. The number
in front of a folder name sets the order of the doors and is dropped from the
title. Rooms of more than six photographs continue round a corner into a
second part.

## room.json (optional)

    {
      "title": "Black and White",
      "subtitle": "Grain, and nothing else",
      "mood": "noir"
    }

`mood` sets how the room looks:

- `concrete`: warm, board-marked concrete and warm lamps. For colour work.
- `noir`: near-black walls and cool lamps. Made for black and white.
- `gallery`: pale plaster, a light floor, daylight. For travel and landscape.

Folders without a `room.json` take the three looks in turn.

## Loose files

Images dropped straight into `drop/` with no folder still work. They are dealt
into a few rooms for you, which is handy for a quick look. Use folders for the
real show.

To go back to the built-in demo exhibition:

    rm data/generated.json
