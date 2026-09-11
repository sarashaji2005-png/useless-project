import { useCallback, useState } from 'react';
import { useCamera } from './camera/useCamera';
import { useScanEngine } from './detect/useScanEngine';
import { SurveillanceScreen } from './components/SurveillanceScreen';
import { MusicalChairsScreen } from './components/MusicalChairsScreen';
import { LandingScreen } from './components/landing/LandingScreen';

/**
 * Two screens, one state value. A router library for two destinations would be
 * more machinery than the problem needs.
 *
 * ONE PIPELINE, TWO VIEWS. The camera and scan engine live here, at app level,
 * and both screens read the same engine state. Screen 2 is not a separate
 * system — it renders its own display <video> attached to the SAME MediaStream
 * and consumes the SAME tracked chairs, occupancy and visibility scores.
 *
 * Note the reversal from the previous iteration: the scan is NO LONGER stopped
 * when navigating to Screen 2. It used to be, because the old Screen 2 was an
 * abstract seat grid that did not need a camera. The Musical Chairs screen needs
 * the live feed, so the pipeline stays up across navigation.
 */

type Screen = 'landing' | 'surveillance' | 'musicalChair';

/**
 * Dev-only deep link, e.g. `?screen=musicalChair`.
 *
 * Exists so a screen can be captured headlessly without a camera and without
 * clicking through the flow. Gated on `import.meta.env.DEV`, so the production
 * bundle always starts at the landing screen no matter what the URL says.
 */
function initialScreen(): Screen {
  if (!import.meta.env.DEV) return 'landing';

  const want = new URLSearchParams(window.location.search).get('screen');
  return want === 'surveillance' || want === 'musicalChair' ? want : 'landing';
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);

  const camera = useCamera();
  const engine = useScanEngine(camera.grabFrame);
  const [frozenFrame, setFrozenFrame] = useState<HTMLCanvasElement | null>(null);

  const frameW = camera.state.frameWidth || frozenFrame?.width || 1280;
  const frameH = camera.state.frameHeight || frozenFrame?.height || 720;

  const handleStart = useCallback(async () => {
    setFrozenFrame(null);
    await camera.start();
    await engine.start();
  }, [camera, engine]);

  const handleStop = useCallback(() => {
    // Copy the current frame before releasing the camera, otherwise the video
    // goes black and there is nothing left to freeze.
    const live = camera.grabFrame();
    if (live) {
      const still = document.createElement('canvas');
      still.width = live.width;
      still.height = live.height;
      still.getContext('2d')?.drawImage(live, 0, 0);
      setFrozenFrame(still);
    }
    engine.stop();
    camera.stop();
  }, [camera, engine]);

  // The teacher position is no longer clicked. useScanEngine derives it per tick
  // from the frame size via core/roomConfig, so there is no setter to wire up.

  return (
    <div className="app">
      {/*
        The single CAPTURE video element, mounted once for the whole app lifetime
        and never unmounted. Everything the detector sees comes through here, so
        frame capture is independent of which screen is displayed.

        Visually hidden via clipping rather than `display: none` — a display-none
        video is not guaranteed to keep decoding frames, which would silently
        starve the detector.
      */}
      <video ref={camera.captureVideoRef} className="capture-sink" playsInline muted />

      {/* Header belongs to the two tool screens. The landing page brings its own
          hero, so it would be a duplicate title there. */}
      {screen !== 'landing' && (
        <header className="hud">
          <button className="nav" onClick={() => setScreen('landing')}>
            ◀ HOME
          </button>
          <h1>HIDE N SEAT</h1>
          <span className="tag">
            {screen === 'surveillance'
              ? 'GAZE-MITIGATION TELEMETRY · LIVE CHAIR ACQUISITION'
              : 'MUSICAL CHAIRS PROTOCOL · SAFEST VACANT SEAT'}
          </span>
        </header>
      )}

      {screen === 'landing' && (
        <LandingScreen
          onOpenSurveillance={() => setScreen('surveillance')}
          onOpenMusicalChairs={() => setScreen('musicalChair')}
        />
      )}

      {/* Screen 1 is hidden rather than unmounted so its frozen frame and local
          view state survive a round trip to Screen 2 or the landing page. */}
      <div hidden={screen !== 'surveillance'}>
        <SurveillanceScreen
          stream={camera.stream}
          cameraState={camera.state}
          scan={engine.state}
          frozenFrame={frozenFrame}
          frameWidth={frameW}
          frameHeight={frameH}
          onStart={() => void handleStart()}
          onStop={handleStop}
          onGoToMusicalChair={() => setScreen('musicalChair')}
        />
      </div>

      {screen === 'musicalChair' && (
        <MusicalChairsScreen
          stream={camera.stream}
          scan={engine.state}
          frameWidth={frameW}
          frameHeight={frameH}
          onScan={() => void handleStart()}
          onReturn={() => setScreen('surveillance')}
        />
      )}
    </div>
  );
}
