import { Linking } from 'react-native';
import { isHealthDataAvailable, queryStatisticsForQuantity, requestAuthorization } from '@kingstinct/react-native-healthkit';
export const healthName = 'Apple Health';
export async function healthAvailable() { return isHealthDataAvailable(); }
// HealthKit deliberately does not disclose whether a read permission was denied.
// The app's explicit connection flag gates all queries; empty data stays empty.
export async function healthAuthorized() { return healthAvailable(); }
export async function authorizeHealth() {
  if (!await healthAvailable()) return false;
  await requestAuthorization({ toRead: ['HKQuantityTypeIdentifierStepCount'] });
  return true;
}
export async function readHealthSteps(start: number, end: number) {
  if (end <= start) return 0;
  const result = await queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], { unit: 'count', filter: { date: { startDate: new Date(start), endDate: new Date(end) } } });
  return Math.max(0, Math.round(result.sumQuantity?.quantity ?? 0));
}
export async function openHealthSettings() { await Linking.openURL('x-apple-health://'); }
