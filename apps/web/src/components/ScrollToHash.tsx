'use client';

import { useEffect } from 'react';

/** Jumps to the `#card` in the address once the page is ready (the browser's own jump can miss). */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
