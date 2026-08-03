import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../Sidebar';

describe('Sidebar', () => {
  it('renders both nav items when expanded', () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Project Bar (Register Mode)')).toBeInTheDocument();
    expect(screen.getByText('Project Bar (Address Mode)')).toBeInTheDocument();
  });

  it('shows toggle button', () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(screen.getByText('◀')).toBeInTheDocument();
  });

  it('shows expand arrow when collapsed', () => {
    render(<Sidebar collapsed={true} onToggle={vi.fn()} />);
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('calls onToggle when toggle button clicked', () => {
    const fn = vi.fn();
    render(<Sidebar collapsed={false} onToggle={fn} />);
    fireEvent.click(screen.getByText('◀'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Address Mode button is disabled', () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const btn = screen.getByText('Project Bar (Address Mode)').closest('button');
    expect(btn).toBeDisabled();
  });

  it('Register Mode button is not disabled (active)', () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const btn = screen.getByText('Project Bar (Register Mode)');
    expect(btn).not.toBeDisabled();
  });
});
