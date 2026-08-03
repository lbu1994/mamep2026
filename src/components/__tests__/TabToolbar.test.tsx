import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabToolbar from '../TabToolbar';

describe('TabToolbar', () => {
  it('renders Upload button', () => {
    render(<TabToolbar uploading={false} onUpload={vi.fn()} />);
    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

  it('shows Uploading... and is disabled when uploading', () => {
    render(<TabToolbar uploading={true} onUpload={vi.fn()} />);
    const btn = screen.getByText('Uploading...');
    expect(btn).toBeDisabled();
  });

  it('calls onUpload when clicked', () => {
    const fn = vi.fn();
    render(<TabToolbar uploading={false} onUpload={fn} />);
    fireEvent.click(screen.getByText('Upload'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Enter(ROM) is disabled', () => {
    render(<TabToolbar uploading={false} onUpload={vi.fn()} />);
    expect(screen.getByText('Enter(ROM)')).toBeDisabled();
  });

  it('Enter(RAM) is disabled', () => {
    render(<TabToolbar uploading={false} onUpload={vi.fn()} />);
    expect(screen.getByText('Enter(RAM)')).toBeDisabled();
  });
});
