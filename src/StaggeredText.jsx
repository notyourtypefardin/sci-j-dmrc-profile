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
  segmentBy = 'words',
  delay = 80,
  duration = 0.6,
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

  const ordered = staggerDirection === 'reverse'
    ? [...segments].reverse()
    : segments;

  const distance = direction === 'bottom' ? '0 0 24px' :
    direction === 'left' ? '24px 0 0' :
    direction === 'right' ? '-24px 0 0' : '0 0 -24px';

  return React.createElement(
    Tag,
    { ref, className: `dmrc-staggered-text ${className}` },
    segments.map((segment, index) => {
      const orderIndex = ordered.indexOf(segment);
      const isSpace = /^\\s+$/.test(segment);
      const safeIndex = orderIndex < 0 ? index : orderIndex;
      return (
        <span
          key={`${index}-${segment}`}
          className={isSpace ? 'dmrc-stagger-space' : 'dmrc-stagger-segment'}
          style={{
            '--stagger-delay': `${safeIndex * delay}ms`,
            '--stagger-duration': `${duration}s`,
            '--stagger-distance': distance,
            '--stagger-ease': EASINGS[easing] || easing || EASINGS.anticipate,
            '--stagger-blur': blur ? '10px' : '0px',
            opacity: visible || isSpace ? 1 : 0,
            transform: visible || isSpace ? 'translate3d(0,0,0)' : `translate3d(var(--stagger-distance))`,
            filter: visible || isSpace ? 'blur(0)' : 'blur(var(--stagger-blur))',
            transition: visible
              ? `opacity var(--stagger-duration) var(--stagger-ease) var(--stagger-delay), transform var(--stagger-duration) var(--stagger-ease) var(--stagger-delay), filter var(--stagger-duration) var(--stagger-ease) var(--stagger-delay)`
              : 'none'
          }}
        >
          {segment}
        </span>
      );
    })
  );
}
