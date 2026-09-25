import { useCallback, useEffect, useRef, useState } from 'react';

// Small "Збережено ✓"-style toast shared by the pages. Returns the current state
// for rendering plus show(text); the timer is cleared on unmount so a toast
// fired right before navigation never updates an unmounted component.
export default function useToast(duration = 3000) {
  const [toast, setToast] = useState({ visible: false, text: '' });
  const timerRef = useRef(null);

  const show = useCallback(
    (text) => {
      setToast({ visible: true, text });
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => setToast((t) => ({ ...t, visible: false })),
        duration
      );
    },
    [duration]
  );

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return [toast, show];
}
