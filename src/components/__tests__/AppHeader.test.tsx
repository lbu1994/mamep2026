import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppHeader from '../AppHeader';

describe('AppHeader', () => {
  it('renders app name', () => {
    render(<AppHeader status="disconnected" portInfo="" onOpenConfig={vi.fn()} />);
    expect(screen.getByText('Mamep2026 Demo')).toBeInTheDocument();
  });

  it('renders version number', () => {
    render(<AppHeader status="disconnected" portInfo="" onOpenConfig={vi.fn()} />);
    expect(screen.getByText(/v\d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  it('shows disconnected status', () => {
    render(<AppHeader status="disconnected" portInfo="" onOpenConfig={vi.fn()} />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows port info when connected', () => {
    render(<AppHeader status="connected" portInfo="COM3" onOpenConfig={vi.fn()} />);
    expect(screen.getByText('COM3')).toBeInTheDocument();
  });

  it('calls onOpenConfig when serial config button clicked', () => {
    const fn = vi.fn();
    render(<AppHeader status="disconnected" portInfo="" onOpenConfig={fn} />);
    fireEvent.click(screen.getByText(/Serial Config/));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('plugin button is disabled', () => {
    render(<AppHeader status="disconnected" portInfo="" onOpenConfig={vi.fn()} />);
    const btn = screen.getByText(/Plugin/);
    expect(btn).toBeDisabled();
  });
});
