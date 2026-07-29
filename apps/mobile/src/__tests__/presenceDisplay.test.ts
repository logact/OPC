import { presenceDisplay } from '../utils/presenceDisplay';
import { theme } from '../theme';

describe('presenceDisplay', () => {
  it('maps a missing presence to offline', () => {
    expect(presenceDisplay(undefined)).toEqual({
      state: 'offline',
      color: theme.colors.muted,
      label: 'offline',
    });
  });

  it('maps online:false to offline even when a status is present', () => {
    const display = presenceDisplay({ online: false, status: 'working' });
    expect(display.state).toBe('offline');
    expect(display.color).toBe(theme.colors.muted);
    expect(display.label).toBe('offline');
  });

  it('defaults an online presence without status to idle', () => {
    const display = presenceDisplay({ online: true });
    expect(display.state).toBe('idle');
    expect(display.color).toBe(theme.colors.accent);
    expect(display.label).toBe('idle');
  });

  it('maps working to the green accent2', () => {
    const display = presenceDisplay({ online: true, status: 'working' });
    expect(display.state).toBe('working');
    expect(display.color).toBe(theme.colors.accent2);
    expect(display.label).toBe('working');
  });

  it('maps blocking to the amber warning color', () => {
    const display = presenceDisplay({ online: true, status: 'blocking' });
    expect(display.state).toBe('blocking');
    expect(display.color).toBe(theme.colors.warning);
    expect(display.label).toBe('blocking');
  });

  it('maps error to the danger color', () => {
    const display = presenceDisplay({ online: true, status: 'error' });
    expect(display.state).toBe('error');
    expect(display.color).toBe(theme.colors.danger);
    expect(display.label).toBe('error');
  });
});
