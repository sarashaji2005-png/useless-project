# Audio

## Current file

`cid-moosa.mp3` — present, 276,572 bytes, ~11 seconds.

Copied from `C:\Users\Lenovo\Music\cidi moosa.mpeg`. Despite the `.mpeg`
extension the source is an MP3: its header starts with `49 44 33 04`, an ID3v2.4
tag. It was renamed to `.mp3` on the way in so Vite serves it as `audio/mpeg`
rather than `video/mpeg` — an `<audio>` element is not reliable with a video MIME
type even when the bytes underneath are decodable.

The name was also changed to remove the space. Spaces in a URL need percent
encoding, which is one more thing to get wrong for no benefit.

## How it is loaded

`MUSIC_SRC` in `src/components/MusicalChairsScreen.tsx` points at
`/sounds/cid-moosa.mp3`. Vite serves `public/` verbatim, so no import or bundler
step is involved — dropping a replacement file at this path is enough, no restart
needed.

## Round length vs track length

The round is a fixed 10 seconds (`ROUND_MS`) and playback is cut at that mark
regardless of the file's real length. This clip is ~11s, so roughly the last
second never plays. Raise `ROUND_MS` to 11000 if you want it to finish.

A clip *shorter* than the round is also fine — the audio ends early and the
remaining time runs silent. The round always takes the full 10 seconds.

## Verifying a replacement file

Vite answers missing files under `public/` with HTTP 200 and the contents of
`index.html`, so a 200 proves nothing. Check the **Content-Type**:

- `audio/mpeg` — the file is there
- `text/html` — it is not

## Status handling in the app

- **missing** — nothing at that path. The round still runs, silently.
- **blocked** — the browser refused playback. Autoplay policy needs a real user
  gesture; the Start Music click qualifies.

Neither state can take the demo down. The reveal works without audio.

## Licensing

This is film audio and it is copyrighted. Whether it can be used in a public
showcase is not a question this file can answer.
