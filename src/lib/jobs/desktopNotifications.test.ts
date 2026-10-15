import { describe, expect, it } from 'vitest';
import { desktopSwitchState, desktopToggleAction } from './desktopNotifications';

describe('desktop notification preference', () => {
  it('asks again when a saved on preference has reset permission', () => {
    expect(desktopToggleAction(true, 'default')).toBe('request');
    expect(desktopToggleAction(true, 'granted')).toBe('disable');
    expect(desktopToggleAction(false, 'granted')).toBe('request');
  });
  it('does not present a failed notification constructor as working', () => {
    expect(desktopSwitchState(true, 'unavailable')).toEqual({
      checked: false, disabled: true, status: 'This browser cannot show desktop notifications here',
    });
    expect(desktopToggleAction(true, 'unavailable')).toBe('none');
  });
  it('shows reset permission as off and lets the user ask again', () => {
    expect(desktopSwitchState(true, 'default')).toEqual({ checked: false, disabled: false, status: 'Off' });
  });
});
