import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageBar from '../MessageBar';

describe('MessageBar', () => {
  it('renders all 4 tabs', () => {
    render(<MessageBar />);
    expect(screen.getByText('Message List')).toBeInTheDocument();
    expect(screen.getByText('Comm. Log List')).toBeInTheDocument();
    expect(screen.getByText('Comm. properties')).toBeInTheDocument();
    expect(screen.getByText('OMAKE Note')).toBeInTheDocument();
  });

  it('shows Message List content by default', () => {
    render(<MessageBar />);
    expect(screen.getByText(/Welcome/)).toBeInTheDocument();
  });

  it('switches content when clicking another tab', () => {
    render(<MessageBar />);
    fireEvent.click(screen.getByText('Comm. Log List'));
    expect(screen.getByText(/Comm\. Log — Coming Soon/)).toBeInTheDocument();
  });
});
