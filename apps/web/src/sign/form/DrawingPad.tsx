import Box from '@mui/material/Box';
import { useEffect, useRef } from 'react';
import SignaturePad from 'signature_pad';

interface DrawingPadProps {
  /** The saved drawing (PNG data URL), or '' for none: drawn again whenever the pad is resized. */
  value: string;
  /** A stroke ended: the whole drawing as a PNG data URL. */
  onDraw: (png: string) => void;
  /** The accessible name of the drawing area. */
  label: string;
  /** Height on screen in CSS pixels; the width follows the card (up to `maxWidth`). */
  height: number;
  maxWidth: number;
  /** Bumped by the caller's "ניקוי" button: the pad is emptied. */
  clearSignal: number;
}

/**
 * A drawing area for the mouse (touch also works), smoothed by signature_pad: a drawing box on
 * B3 (FR-TPL-9), and in part B the signature itself. The canvas has the screen's pixel density,
 * so a resize, a browser zoom or a `devicePixelRatio` change resizes it; it is then drawn again
 * from the saved PNG, so nothing she drew is lost. Nothing is kept outside the caller's state.
 */
export function DrawingPad({
  value,
  onDraw,
  label,
  height,
  maxWidth,
  clearSignal,
}: DrawingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const saved = useRef(value);
  const onDrawRef = useRef(onDraw);
  useEffect(() => {
    saved.current = value;
    onDrawRef.current = onDraw;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const pad = new SignaturePad(canvas, { minWidth: 1, maxWidth: 3, penColor: '#000' });
    padRef.current = pad;
    let size = { width: 0, height: 0, ratio: 0 };

    const fit = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = canvas.offsetWidth;
      const shown = canvas.offsetHeight;
      if (width === 0 || shown === 0) return;
      if (width === size.width && shown === size.height && ratio === size.ratio) return;
      size = { width, height: shown, ratio };
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(shown * ratio);
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      if (saved.current !== '') {
        void pad.fromDataURL(saved.current, { ratio, width, height: shown }).catch(() => {});
      }
    };
    const strokeEnded = () => {
      if (!pad.isEmpty()) onDrawRef.current(pad.toDataURL('image/png'));
    };

    fit();
    pad.addEventListener('endStroke', strokeEnded);
    window.addEventListener('resize', fit);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(canvas);
    return () => {
      pad.removeEventListener('endStroke', strokeEnded);
      window.removeEventListener('resize', fit);
      observer?.disconnect();
      pad.off();
      padRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (clearSignal > 0) padRef.current?.clear();
  }, [clearSignal]);

  return (
    <Box
      component="canvas"
      ref={canvasRef}
      role="img"
      aria-label={label}
      sx={{
        display: 'block',
        width: '100%',
        maxWidth,
        height,
        bgcolor: 'common.white',
        border: 2,
        borderColor: 'divider',
        borderRadius: 1,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
    />
  );
}
