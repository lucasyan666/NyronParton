# Fonts for 3D titles

The hover titles are rendered with troika (via drei's `<Text>`), which needs a
font file it can parse: **.ttf, .otf or .woff — not .woff2**.

With no font set, troika fetches a default from a CDN at runtime, so the first
hover title waits on a network request.

To fix that and choose the face deliberately:

1. Drop a licensed font file in this folder.
2. Set `TITLE_FONT` at the top of `components/FrameLabel.tsx`:

   const TITLE_FONT = '/fonts/YourDisplay.woff';

Good open options for this design (all SIL OFL, free for commercial use):
Archivo, Archivo Black, Space Grotesk, Inter, Anton.
Download from fonts.google.com — pick the .ttf, or convert to .woff.

Note: macOS system fonts (Helvetica, SF) are licensed to the machine and must
not be redistributed with a website.
