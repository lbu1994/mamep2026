import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SerialConfigModal from '../SerialConfigModal';

function renderModal(overrides = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    onConnect: vi.fn(() => Promise.resolve(true)),
    onDisconnect: vi.fn(),
    connected: false,
    ...overrides,
  };
  return { ...render(<SerialConfigModal {...props} />), props };
}

describe('SerialConfigModal', () => {
  it('does not render when open=false', () => {
    render(<SerialConfigModal open={false} onClose={vi.fn()} onConnect={vi.fn()} onDisconnect={vi.fn()} connected={false} />);
    expect(screen.queryByText('Serial Config')).not.toBeInTheDocument();
  });

  it('renders when open=true', () => {
    renderModal();
    expect(screen.getByText('Serial Config')).toBeInTheDocument();
  });

  it('renders enabled fields', () => {
    renderModal();
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.getByText('Data Length')).toBeInTheDocument();
    expect(screen.getByText('Stop Bit')).toBeInTheDocument();
    expect(screen.getByText('Parity Bit')).toBeInTheDocument();
    expect(screen.getByText('Slave Address')).toBeInTheDocument();
    expect(screen.getByText('Rx Delay')).toBeInTheDocument();
  });

  it('renders disabled fields with hint', () => {
    renderModal();
    expect(screen.getByText('Flow Control')).toBeInTheDocument();
    expect(screen.getByText('The following parameters are not supported (Demo)')).toBeInTheDocument();
  });

  it('calls onClose when cancel button clicked', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('calls onClose when X button clicked', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('✕'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows disconnect button when connected=true', () => {
    renderModal({ connected: true });
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
    expect(screen.queryByText('Connect')).not.toBeInTheDocument();
  });

  it('shows connect button when connected=false', () => {
    renderModal({ connected: false });
    expect(screen.getByText('Connect')).toBeInTheDocument();
    expect(screen.queryByText('Disconnect')).not.toBeInTheDocument();
  });

  it('connect button becomes disabled while connecting', async () => {
    // Simulate slow connection
    const slowConnect = vi.fn(() => new Promise<boolean>(() => {})); // never resolves
    renderModal({ onConnect: slowConnect });

    fireEvent.click(screen.getByText('Connect'));
    expect(screen.getByText('Connecting...')).toBeDisabled();
  });

  it('slave address input has range 0~255', () => {
    renderModal();
    // Find the enabled spinbutton (Slave Address) vs disabled (Retry Counter)
    const inputs = screen.getAllByRole('spinbutton');
    const slaveInput = inputs.find((el) => !(el as HTMLInputElement).disabled) as HTMLInputElement;
    expect(slaveInput).toBeDefined();
    expect(slaveInput).toHaveAttribute('min', '0');
    expect(slaveInput).toHaveAttribute('max', '255');
  });

  it('slave address defaults to 1', () => {
    renderModal();
    const inputs = screen.getAllByRole('spinbutton');
    const slaveInput = inputs.find((el) => !(el as HTMLInputElement).disabled) as HTMLInputElement;
    expect(slaveInput).toBeDefined();
    expect(slaveInput.value).toBe('1');
  });
});
