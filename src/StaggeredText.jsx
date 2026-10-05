import React, { useEffect, useMemo, useRef, useState } from 'react';

const EASINGS = {
  anticipate: 'cubic-bezier(0.22, 1, 0.36, 1)',
  smooth: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  linear: 'linear'
};

export default function StaggeredText({
  text = '',
  className = '',
  as: Tag = 'p',
  segmentBy = 'chars',
  delay = 35,
  duration = 0.55,
  direction = 'top',
  blur = true,
  staggerDirection = 'forward',
  easing = 'anticipate',
  threshold = 0.1,
  rootMargin = '0px',
  respectReducedMotion = true
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  const segments = useMemo(() => {
    if (segmentBy === 'chars') return Array.from(text);
    if (segmentBy === 'lines') return text.split('\\n');
    return text.split(/(\\s+)/);
  }, [text, segmentBy]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = respectReducedMotion &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold, rootMargin });

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, respectReducedMotion]);

  const order = staggerDirection === 'reverse'
    ? segments.map((_, i) => segments.length - 1 - i)
    : segments.map((_, i) => i);

  const distance = direction === 'bottom' ? { x: '0px', y: '18px' } :
    direction === 'left' ? { x: '18px', y: '0px' } :
    direction === 'right' ? { x: '-18px', y: '0px' } :
    { x: '0px', y: '18px' };

  return React.createElement(
    Tag,
    { ref, className: `dmrc-staggered-text ${className}` },
    segments.map((segment, index) => {
      const isSpace = /\\s/.test(segment);
      const safeIndex = order[index];
      return (
        <span
          key={`${index}-${segment}`}
          className={isSpace ? 'dmrc-stagger-space' : 'dmrc-stagger-segment'}
          aria-hidden="true"
          style={{
            '--stagger-delay': `${safeIndex * delay}ms`,
            '--stagger-duration': `${duration}s`,
            '--stagger-x': distance.x,
            '--stagger-y': distance.y,
            '--stagger-ease': EASINGS[easing] || easing || EASINGS.anticipate,
            '--stagger-blur': blur ? '12px' : '0px',
            opacity: visible ? 1 : 0,
            transform: visible
              ? 'translate3d(0,0,0)'
              : 'translate3d(var(--stagger-x),var(--stagger-y),0)',
            filter: visible ? 'blur(0)' : 'blur(var(--stagger-blur))',
            transition: visible
              ? `opacity var(--stagger-duration) var(--stagger-ease) var(--stagger-delay), transform var(--stagger-duration) var(--stagger-ease) var(--stagger-delay), filter var(--stagger-duration) var(--stagger-ease) var(--stagger-delay)`
              : 'none'
          }}
        >
          {segment === ' ' ? '\u00a0' : segment}
        </span>
      );
    })
  );
}
