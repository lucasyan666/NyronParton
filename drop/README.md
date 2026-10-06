# Drop folder

Each folder in here is a room in the foyer, with its own door, title and
look:

    drop/
      01-events/                → Events          (warm concrete)
      02-press-shots/           → Press Shots     (noir)
      03-food-and-beverage/     → Food & Beverage (pale gallery)
      hero.jpg                  the landing photograph (optional)

Drop the photographs into their room's folder, then run:

    npm run photos:scan

and restart the dev server. Image names, formats and sizes do not matter.
Photos hang in filename order, so number them (01.jpg, 02.jpg …) if the order
matters. The number in front of a folder name sets the order of the doors.
Rooms of more than six photographs continue round a corner into a second part.

An empty folder is still a room. Its door says "Coming soon" until it has
photographs in it.

## room.json

Each folder has one:

    {
      "title": "Food & Beverage",
      "subtitle": "",
      "mood": "gallery"
    }

- `title`: the name on the door and in the room.
- `subtitle`: a line under the name. Left empty, the door shows how many
  works the room holds.
- `mood`: how the room looks.
  - `concrete`: warm, board-marked concrete and warm lamps.
  - `noir`: near-black walls and cool lamps. Made for black and white.
  - `gallery`: pale plaster, a light floor, daylight.

### Words for the photographs (optional)

Until you write them, each work is labelled with its room's name and number
("Events 03"), with no caption, and the year from the photo file's own date.
For film scans that is often the scanning date. To set real ones, add them
to the room's `room.json`, keyed by file name:

    {
      "title": "Events",
      "subtitle": "",
      "mood": "concrete",
      "medium": "35mm film",
      "works": {
        "000059190023.jpg": {
          "title": "Opening Night",
          "caption": "One line about the photograph.",
          "year": "2025"
        }
      }
    }

`medium` and `year` at the top apply to every work in the room; anything in
`works` overrides them for that photograph. Run `npm run photos:scan` again
afterwards.

To add a room, add a folder (`04-portraits/`, say), with or without a
`room.json`.

## Loose files

Images dropped straight into `drop/` with no folder still work. They go into
a room of their own called "More". Use folders for the real show.

To go back to the built-in demo exhibition:

    rm data/generated.json
