export function desktopToggleAction(enabled: boolean, permission: string): 'disable' | 'request' | 'none' {
  if (permission === 'unsupported' || permission === 'unavailable') return 'none';
  return enabled && permission === 'granted' ? 'disable' : permission === 'denied' ? (enabled ? 'disable' : 'none') : 'request';
}

export function desktopSwitchState(enabled: boolean, permission: string) {
  return {
    checked: enabled && permission === 'granted',
    disabled: permission === 'unsupported' || permission === 'unavailable' || (!enabled && permission === 'denied'),
    status: permission === 'unavailable' ? 'This browser cannot show desktop notifications here'
      : permission === 'unsupported' ? 'Desktop notifications are not available in this browser.'
      : permission === 'denied' ? 'Blocked in this browser: allow notifications for this site in the browser settings'
      : enabled && permission === 'granted' ? 'On' : 'Off',
  };
}
