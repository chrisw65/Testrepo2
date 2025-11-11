import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FlipbookPage, PageTexture } from '../types';
import './Flipbook.css';

type Direction = 'forward' | 'backward';

interface AnimationState {
  direction: Direction;
  targetIndex: number;
}

interface FlipbookProps {
  pages: FlipbookPage[];
  texture: PageTexture;
  soundsEnabled: boolean;
}

const TURN_DURATION = 720;
const FLIP_NOISE_DURATION = 0.45;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

export function Flipbook({ pages, texture, soundsEnabled }: FlipbookProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animation, setAnimation] = useState<AnimationState | null>(null);
  const [progress, setProgress] = useState(0);
  const frameRef = useRef<number>();
  const audioContextRef = useRef<AudioContext | null>(null);

  const acquireAudioContext = useCallback(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }, []);

  const playPageTurnSound = useCallback(
    (direction: Direction) => {
      if (!soundsEnabled) {
        return;
      }

      const context = acquireAudioContext();
      if (!context) {
        return;
      }

      const buffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * FLIP_NOISE_DURATION),
        context.sampleRate
      );
      const channel = buffer.getChannelData(0);

      for (let i = 0; i < channel.length; i += 1) {
        const t = i / channel.length;
        const fade = Math.pow(1 - t, 1.8);
        const wind = Math.random() * 2 - 1;
        const directionBias = direction === 'forward' ? 0.1 : -0.1;
        channel[i] = (wind * 0.55 + directionBias) * fade;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;

      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = direction === 'forward' ? 980 : 720;
      filter.Q.value = 1.1;

      const gain = context.createGain();
      const now = context.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.32, now + 0.028);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + FLIP_NOISE_DURATION);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      source.start(now);
      source.stop(now + FLIP_NOISE_DURATION + 0.02);
    },
    [acquireAudioContext, soundsEnabled]
  );

  useEffect(() => {
    const context = audioContextRef.current;
    if (!context) {
      return;
    }

    if (!soundsEnabled && context.state === 'running') {
      void context.suspend();
    }

    if (soundsEnabled && context.state === 'suspended') {
      void context.resume();
    }
  }, [soundsEnabled]);

  useEffect(() => {
    return () => {
      const context = audioContextRef.current;
      if (context) {
        void context.close().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    setCurrentIndex(0);
    setAnimation(null);
    setProgress(0);
  }, [pages]);

  useEffect(() => {
    if (!animation) {
      return undefined;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const next = clamp(elapsed / TURN_DURATION, 0, 1);
      setProgress(easeOutCubic(next));

      if (next < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setCurrentIndex(animation.targetIndex);
        setAnimation(null);
        setProgress(0);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [animation]);

  const canGoForward = currentIndex < pages.length - 1 && !animation;
  const canGoBackward = currentIndex > 0 && !animation;

  const handleForward = useCallback(() => {
    if (!canGoForward) {
      return;
    }
    playPageTurnSound('forward');
    setAnimation({ direction: 'forward', targetIndex: currentIndex + 1 });
  }, [canGoForward, currentIndex, playPageTurnSound]);

  const handleBackward = useCallback(() => {
    if (!canGoBackward) {
      return;
    }
    playPageTurnSound('backward');
    setAnimation({ direction: 'backward', targetIndex: currentIndex - 1 });
  }, [canGoBackward, currentIndex, playPageTurnSound]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        handleForward();
      }
      if (event.key === 'ArrowLeft') {
        handleBackward();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleForward, handleBackward]);

  const pageAspect = useMemo(() => {
    if (!pages.length) {
      return 1.414;
    }
    const first = pages[0];
    return first.height / first.width;
  }, [pages]);

  const leftPage = pages[currentIndex - 1];
  const rightPage = pages[currentIndex];
  const nextPage = pages[currentIndex + 1];
  const previousPage = pages[currentIndex - 2];

  const turningForward = animation?.direction === 'forward';
  const turningBackward = animation?.direction === 'backward';

  let flipFront: FlipbookPage | null = null;
  let flipBack: FlipbookPage | null = null;
  let flipOrigin: 'left' | 'right' = 'left';
  let flipAngle = 0;
  let flipShadowStrength = 0;
  let flipTransform = '';
  let flipSheenStyle: CSSProperties | undefined;
  let flipShadowStyle: CSSProperties | undefined;

  if (turningForward && rightPage) {
    flipFront = rightPage;
    flipBack = nextPage ?? null;
    flipOrigin = 'left';
    flipAngle = -180 * progress;
    const foldProgress = Math.sin(Math.PI * progress);
    const curlProgress = Math.sin((Math.PI * progress) / 2);
    const skew = -10 * foldProgress;
    const translateX = -36 * foldProgress;
    const translateZ = 22 * curlProgress;
    const scaleX = 1 - foldProgress * 0.08;
    flipTransform = `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${flipAngle}deg) skewY(${skew}deg) scaleX(${scaleX})`;
    flipShadowStrength = 0.32 + 0.42 * foldProgress;
    flipSheenStyle = {
      opacity: 0.22 + 0.45 * foldProgress,
      transform: `translateX(${(-30 + 60 * progress).toFixed(2)}%) skewY(${skew * 0.45}deg)`
    };
    flipShadowStyle = {
      opacity: 0.35 + 0.35 * foldProgress,
      transform: `translateX(${(-18 + 36 * progress).toFixed(2)}%) skewY(${skew * 0.35}deg)`
    };
  } else if (turningBackward && leftPage) {
    flipFront = leftPage;
    flipBack = previousPage ?? null;
    flipOrigin = 'right';
    flipAngle = -180 + 180 * progress;
    const foldProgress = Math.sin(Math.PI * progress);
    const curlProgress = Math.sin((Math.PI * progress) / 2);
    const skew = 10 * foldProgress;
    const translateX = 36 * foldProgress;
    const translateZ = 22 * curlProgress;
    const scaleX = 1 - foldProgress * 0.08;
    flipTransform = `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${flipAngle}deg) skewY(${skew}deg) scaleX(${scaleX})`;
    flipShadowStrength = 0.32 + 0.42 * foldProgress;
    flipSheenStyle = {
      opacity: 0.22 + 0.45 * foldProgress,
      transform: `translateX(${(30 - 60 * progress).toFixed(2)}%) skewY(${skew * 0.45}deg)`
    };
    flipShadowStyle = {
      opacity: 0.35 + 0.35 * foldProgress,
      transform: `translateX(${(18 - 36 * progress).toFixed(2)}%) skewY(${skew * 0.35}deg)`
    };
  }

  const spreadStyle = useMemo(() => {
    const style = {} as CSSProperties & Record<string, string>;
    style['--page-aspect'] = pageAspect.toString();
    return style;
  }, [pageAspect]);

  const progressLabel = useMemo(() => {
    if (!pages.length) {
      return 'No pages loaded';
    }
    return `Page ${currentIndex + 1} of ${pages.length}`;
  }, [currentIndex, pages.length]);

  const viewerClassName = useMemo(
    () => `viewer viewer--texture-${texture}`,
    [texture]
  );

  return (
    <div className={viewerClassName}>
      <div className="viewer__book" style={spreadStyle}>
        <div className="book__page book__page--left" aria-hidden={!leftPage}>
          <PageFace page={leftPage} placeholderLabel="Cover" texture={texture} />
        </div>

        <div
          className={`book__page book__page--right ${
            turningForward ? 'book__page--incoming' : ''
          }`}
          aria-hidden={!rightPage}
        >
          <PageFace
            page={turningForward ? nextPage : rightPage}
            placeholderLabel="First page"
            texture={texture}
          />
        </div>

        {flipFront && (
          <div
            className={`book__page book__page--turning book__page--${flipOrigin}`}
            style={{
              transformOrigin: `${flipOrigin} center`,
              transform: flipTransform || `rotateY(${flipAngle}deg)`,
              boxShadow: `0 28px 64px rgba(15, 23, 42, ${flipShadowStrength.toFixed(3)})`
            }}
          >
            <div className="page-face page-face--front">
              <PageFace page={flipFront} placeholderLabel="" texture={texture} />
              <div className="page-face__sheen" style={flipSheenStyle} />
            </div>
            <div className="page-face page-face--back">
              <PageFace page={flipBack} placeholderLabel="" texture={texture} />
              <div className="page-face__shadow" style={flipShadowStyle} />
            </div>
          </div>
        )}
      </div>

      <div className="viewer__controls">
        <button type="button" onClick={handleBackward} disabled={!canGoBackward}>
          ‹ Previous
        </button>
        <span className="viewer__progress">{progressLabel}</span>
        <button type="button" onClick={handleForward} disabled={!canGoForward}>
          Next ›
        </button>
      </div>
    </div>
  );
}

interface PageFaceProps {
  page?: FlipbookPage | null;
  placeholderLabel: string;
  texture: PageTexture;
}

function PageFace({ page, placeholderLabel, texture }: PageFaceProps) {
  if (!page) {
    return (
      <div className="page-face__placeholder" aria-hidden="true">
        <span>{placeholderLabel}</span>
      </div>
    );
  }

  return (
    <div className={`page-face__content page-face__content--${texture}`}>
      <div className="page-face__image" style={{ backgroundImage: `url(${page.image})` }} />
      <div className="page-face__texture" aria-hidden="true" />
    </div>
  );
}
