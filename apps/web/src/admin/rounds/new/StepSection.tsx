import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * One wizard step: an h2 and its content. The heading takes the focus when the step opens
 * (not on the page's first render), so a screen reader hears where it is.
 */
export function StepSection({
  title,
  focusOnOpen,
  actions,
  children,
}: {
  title: string;
  focusOnOpen: boolean;
  /** Next to the heading (e.g. "refresh"). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnOpen) heading.current?.focus();
  }, [focusOnOpen]);
  return (
    <Box component="section" aria-labelledby={id} sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Typography
          variant="h2"
          id={id}
          ref={heading}
          tabIndex={-1}
          sx={{ '&:focus': { outline: 'none' } }}
        >
          {title}
        </Typography>
        {actions}
      </Box>
      {children}
    </Box>
  );
}
