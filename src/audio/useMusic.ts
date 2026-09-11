import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Music playback.
 *
 * The round is a fixed 10 seconds and the audio is cut at that mark regardless
 * of the file's real length, so nothing here needs to know the duration or watch
 * for the track ending.
 *
 * The file is NOT in the repo and cannot be generated — it has to be dropped in
 * by hand (see public/sounds/README.md). The round runs silently without it.
 *
 * Detection note: Vite's dev server answers missing files under public/ with
 * HTTP 200 and index.html, so a status-code probe would report the file as
 * present. Detection goes through the media element's own error event, which
 * correctly rejects HTML that cannot be decoded as audio.
 */

export type MusicStatus = 'unknown' | 'ready' | 'missing' | 'blocked';

export function useMusic(src: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<MusicStatus>('unknown');

  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audioRef.current = audio;

    const onReady = () => setStatus('ready');
    const onError = () => setStatus('missing');

    audio.addEventListener('loadedmetadata', onReady);
    audio.addEventListener('canplaythrough', onReady);
    audio.addEventListener('error', onError);
    audio.load();

    return () => {
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('error', onError);
      audio.pause();
      audioRef.current = null;
    };
  }, [src]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Restart from the top so a re-press replays rather than resuming.
    audio.currentTime = 0;
    audio
      .play()
      .then(() => setStatus('ready'))
      .catch((err: unknown) => {
        const name = (err as DOMException)?.name;
        setStatus(name === 'NotSupportedError' ? 'missing' : 'blocked');
      });
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  return { status, play, stop };
}
