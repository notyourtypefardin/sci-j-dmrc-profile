import React from 'react';
import { createRoot } from 'react-dom/client';
import StaggeredText from './StaggeredText.jsx';
import './StaggeredText.css';

const mount = () => {
  const el = document.getElementById('staggeredWelcome');
  if (!el) return;
  createRoot(el).render(
    <StaggeredText
      text={"Welcome to\nDMRC"}
      as="h1"
      segmentBy="chars"
      staggerDirection="forward"
      direction="top"
      easing="anticipate"
      duration={0.55}
      delay={35}
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
