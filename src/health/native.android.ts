import { Linking } from 'react-native';
import { aggregateRecord, getGrantedPermissions, getSdkStatus, initialize, openHealthConnectSettings, requestPermission, SdkAvailabilityStatus } from 'react-native-health-connect';

export const healthName = 'Health Connect';
export async function healthAvailable() {
  return await getSdkStatus() === SdkAvailabilityStatus.SDK_AVAILABLE && await initialize();
}
export async function healthAuthorized() {
  if (!await healthAvailable()) return false;
  return (await getGrantedPermissions()).some(p => 'recordType' in p && p.recordType === 'Steps' && p.accessType === 'read');
}
export async function authorizeHealth() {
  if (!await healthAvailable()) return false;
  const permissions = await requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
  return permissions.some(p => 'recordType' in p && p.recordType === 'Steps' && p.accessType === 'read');
}
export async function readHealthSteps(start: number, end: number) {
  if (end <= start) return 0;
  // Health Connect's aggregate API deduplicates overlapping phone/watch sources.
  const data = await aggregateRecord({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() } });
  return Math.max(0, Math.round(data.COUNT_TOTAL ?? 0));
}
export async function openHealthSettings() {
  if (await healthAvailable()) openHealthConnectSettings();
  else await Linking.openURL('market://details?id=com.google.android.apps.healthdata');
}
