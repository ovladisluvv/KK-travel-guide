# Archive - the original implementation (2022)

This folder holds the **first version** of the Krasnodar Krai travel guide, kept
here for reference

It's preserved as-is - the code is intentionally **not** cleaned up or updated

## What it is
A single hand-written `index.html` with a matching `style.css`. Content
is laid out with an old-school HTML table: a contents block split
into three zones - mountain, water and plant - linking down to sections about
each place. There's a full-width autoplay video banner and a back-to-top icon

## Files
- `index.html` - the whole guide, one page
- `style.css` - the styling
- `zapovednik_final.mp4` - the header video banner
- `back_back.jpg` - page background image
- `iconka-up.png` - the "back to top" icon

## Running it
Just open `index.html` in a browser - no server or build needed. Note that some
images were hotlinked from external sites at the time and may no longer load

## How the current version differs

The rewrite keeps the same spirit and the same places, but reorganizes
everything into a clean, data-driven vanilla site: places live in a JS data
file, cards/filters/search are generated dynamically, and there's an interactive
map-based route planner. See the [root README](../README.md) for the full story
