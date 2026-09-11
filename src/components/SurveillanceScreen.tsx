import { FeedOverlay } from './FeedOverlay';
import { BETTER_WORD } from '../core/scoreDisplay';
import type { CameraState } from '../camera/useCamera';
import type { ScanEngineState } from '../detect/useScanEngine';

/**
 * Screen 1 — unchanged behaviour, extracted from App so the router can swap
 * screens.
 *
 * The camera and scan engine deliberately do NOT live here. They stay in App, so
 * that navigating to the Musical Chair screen does not unmount them and destroy
 * the session's scan data — Screen 2 reads the last tick from that same state.
 */

interface Props {
  stream: MediaStream | null;
  cameraState: CameraState;
  scan: ScanEngineState;
  frozenFrame: HTMLCanvasElement | null;
  frameWidth: number;
  frameHeight: number;
  onStart: () => void;
  onStop: () => void;
  onGoToMusicalChair: () => void;
}

export function SurveillanceScreen({
  stream,
  cameraState,
  scan,
  frozenFrame,
  frameWidth,
  frameHeight,
  onStart,
  onStop,
  onGoToMusicalChair,
}: Props) {
  const { running, detectorStatus, error, lastResult, bestChairScore, facingDeg } = scan;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={onStart} disabled={running}>
          START SCAN
        </button>
        <button className="danger" onClick={onStop} disabled={!running}>
          STOP SCAN
        </button>
        <span className="nav-spacer" />
        <button className="nav" onClick={onGoToMusicalChair}>
          PROCEED TO MUSICAL CHAIR PROTOCOL ▶
        </button>
      </div>

      {detectorStatus === 'loading' && (
        <div className="notice info">
          Loading COCO-SSD (mobilenet_v2). First run downloads a few MB.
        </div>
      )}
      {cameraState.status !== 'live' && cameraState.status !== 'idle' && (
        <div className="notice bad">{cameraState.message}</div>
      )}
      {error && <div className="notice bad">Pipeline error: {error}</div>}

      <FeedOverlay
        stream={stream}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        frozenFrame={frozenFrame}
        result={lastResult}
        bestChairScore={bestChairScore}
        facingDeg={facingDeg}
        running={running}
      />

      <p className="hint">
        Click anywhere on the feed to set or move the teacher position. Big badge =
        occlusion-adjusted exposure out of 100, coloured by band. Solid cyan border
        = occupied, grey = empty, dashed = still acquiring. Dashed red lines point
        at the dominant blocker; green arrows point at a {BETTER_WORD.toLowerCase()}{' '}
        empty seat. Full stage-by-stage trace, including the suggestion debouncer
        state, is in the browser console.
      </p>
    </>
  );
}
