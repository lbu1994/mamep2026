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
    expect(screen.queryByText('串口设置')).not.toBeInTheDocument();
  });

  it('renders when open=true', () => {
    renderModal();
    expect(screen.getByText('串口设置')).toBeInTheDocument();
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
    expect(screen.getByText('以下参数暂不支持（Demo）')).toBeInTheDocument();
  });

  it('calls onClose when cancel button clicked', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('取消'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('calls onClose when X button clicked', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('✕'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows disconnect button when connected=true', () => {
    renderModal({ connected: true });
    expect(screen.getByText('断开')).toBeInTheDocument();
    expect(screen.queryByText('连接')).not.toBeInTheDocument();
  });

  it('shows connect button when connected=false', () => {
    renderModal({ connected: false });
    expect(screen.getByText('连接')).toBeInTheDocument();
    expect(screen.queryByText('断开')).not.toBeInTheDocument();
  });

  it('connect button becomes disabled while connecting', async () => {
    // Simulate slow connection
    const slowConnect = vi.fn(() => new Promise<boolean>(() => {})); // never resolves
    renderModal({ onConnect: slowConnect });

    fireEvent.click(screen.getByText('连接'));
    expect(screen.getByText('连接中...')).toBeDisabled();
  });
});
