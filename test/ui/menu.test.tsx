import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Button, Disclosure, Meter } from '../../src/ui/theme';

describe('illustrated menu controls', () => {
  it('keeps an illustrated button named and prevents disabled actions', async () => {
    const onPress = jest.fn();
    const view = await render(<Button icon="sword" label="Enter dungeon" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Enter dungeon' }));
    expect(onPress).not.toHaveBeenCalled();
    await view.rerender(<Button icon="sword" label="Enter dungeon" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Enter dungeon' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lets players reveal and hide the daily rules with an announced expanded state', async () => {
    await render(<Disclosure title="Daily activity rules"><Text>Daily bonuses reset at 5 AM.</Text></Disclosure>);
    expect(screen.queryByText('Daily bonuses reset at 5 AM.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Daily activity rules' }).props.accessibilityState).toEqual({ expanded: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Daily activity rules' }));
    expect(screen.getByText('Daily bonuses reset at 5 AM.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Daily activity rules' }).props.accessibilityState).toEqual({ expanded: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Daily activity rules' }));
    expect(screen.queryByText('Daily bonuses reset at 5 AM.')).toBeNull();
  });

  it('bounds announced quest progress, including empty or unavailable totals', async () => {
    const view = await render(<Meter value={140} max={100} label="Daily quest" />);
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
    await view.rerender(<Meter value={NaN} max={0} label="Daily quest" />);
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 0, now: 0 });
  });
});
