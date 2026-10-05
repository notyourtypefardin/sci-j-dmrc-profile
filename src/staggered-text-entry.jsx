import React from 'react';
import { createRoot } from 'react-dom/client';
import StaggeredText from './StaggeredText.jsx';
import './StaggeredText.css';

const mount = () => {
  const el = document.getElementById('staggeredWelcome');
  if (!el) return;
  createRoot(el).render(
    <StaggeredText
      text="Welcome to DMRC"
      as="h1"
      segmentBy="words"
      staggerDirection="forward"
      direction="top"
      easing="anticipate"
      duration={0.7}
      delay={90}
      blur={true}
      threshold={0}
      rootMargin="0px"
    />
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once:true });
} else {
  mount();
}
