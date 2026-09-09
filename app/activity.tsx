import { Redirect, useLocalSearchParams } from 'expo-router';

/** Preserve older links without keeping manual entry in the new workout flow. */
export default function ActivityRedirect() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return <Redirect href={mode === 'run' ? '/run' : '/health'} />;
}
