import { TextareaHTMLAttributes, useRef } from 'react';

export const GrowingTextArea = ({
  className,
  onChange,
  maxHeightPx = 440,
  minHeightPx = 82,
  flexGrow = false,
  ...other
}: {
  maxHeightPx?: number;
  minHeightPx?: number;
  flexGrow?: boolean;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  return (
    <textarea
      className={`resize-none ${className}`}
      style={flexGrow ? { height: '100%' } : { minHeight: minHeightPx + 'px' }}
      ref={ref}
      onChange={(e) => {
        if (flexGrow === false) {
          e.target.style.height = '0';
          let height = Math.max(minHeightPx, e.target.scrollHeight);
          if (maxHeightPx !== 0) {
            height = Math.min(height, maxHeightPx);
          }
          e.target.style.height = `${height}px`;
        }
        onChange?.(e);
      }}
      {...other}
    />
  );
};
