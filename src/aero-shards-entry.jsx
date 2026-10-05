import React from 'react';
import { createRoot } from 'react-dom/client';
import AeroShards from './AeroShards.jsx';

const renderFallback = (el) => {
  el.dataset.unsupported = 'true';
  el.innerHTML = `
    <div class="aero-fallback" aria-hidden="true">
      <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
    </div>
  `;
};

const mount = () => {
  const el = document.getElementById('heroAeroShards');
  if (!el) return;

  if (!('gpu' in navigator)) {
    renderFallback(el);
    return;
  }

  createRoot(el).render(
    <AeroShards
      backgroundColor="#09070A"
      shardColor="#7F1820"
      accentColor="#E11D2E"
      placement="full"
      flow="stream"
      material="pearl"
      detail="balanced"
      effect="none"
      scale={1}
      spread={1}
      depth={1}
      speed={1}
      spin={1}
      interaction="repel"
      density={1.5}
      shardSize={1.1}
      stretch={1}
      turbulence={1}
      glow={1}
      edgeSoftness={2}
      bloom={0.5}
      grain={0.05}
      chromaticAberration={0.0075}
      transitionDuration={1}
      interactionRadius={1.5}
      interactionStrength={0.5}
      rippleIntensity={1}
      holdToGather={true}
    />
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
