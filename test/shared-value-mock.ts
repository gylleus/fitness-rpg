import { useRef } from 'react';

// Model subscriptions with live reads, preserving shared-value identity across
// rerenders. Tests drive the real RN Animated.Value; no scenery clock is mocked.
export function useSharedValue<T>(initial: T) {
  return useRef({ value: initial }).current;
}

export function useDerivedValue<T>(compute: () => T) {
  return { get value() { return compute(); } };
}
